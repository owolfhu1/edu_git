import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import './RemoteRepoModal.css'
import { FileSystemContext } from '../../store/FileSystemContext'
import { lcsDiff } from '../../git/diff'

const BASE_URL = 'https://remote.mock/edu-git'
const REMOTE_NAME = 'origin'
const REMOTE_PATH = '/.remotes/origin'

const normalizePath = (path) => {
  if (!path) {
    return '/'
  }
  const trimmed = path.trim()
  if (trimmed.startsWith('http')) {
    try {
      const url = new URL(trimmed)
      return url.pathname || '/'
    } catch (error) {
      return '/'
    }
  }
  if (trimmed.startsWith('/')) {
    return trimmed
  }
  return `/${trimmed}`
}

const buildFilePath = (branch, path) => {
  const safePath = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `/${encodeURIComponent(branch)}/${safePath}`
}

const parseFilePath = (path, branches) => {
  if (!path || !path.startsWith('/')) {
    return null
  }
  if (path.startsWith('/mr/') || path.startsWith('/merge-requests')) {
    return null
  }
  if (!branches || branches.length === 0) {
    return null
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) {
    return null
  }
  const head = decodeURIComponent(parts[0] || '')
  if (!branches.includes(head)) {
    return null
  }
  const filePath = parts.slice(1).map((part) => decodeURIComponent(part)).join('/')
  if (!filePath) {
    return null
  }
  return { branch: head, filePath }
}

const slugifyTitle = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const parseMrPath = (path) => {
  if (!path.startsWith('/mr/')) {
    return null
  }
  const slug = path.replace(/^\/mr\//, '').trim()
  return slug ? decodeURIComponent(slug) : null
}

const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/branches', label: 'Branches' },
  { path: '/commits', label: 'Commits' },
  { path: '/compare', label: 'Compare' },
  { path: '/merge-requests', label: 'Merge Requests' },
]

const buildRemoteTree = async (fs, dir, gitdir, ref) => {
  const commitOid = await git.resolveRef({ fs, dir, gitdir, ref })
  const { commit } = await git.readCommit({ fs, dir, gitdir, oid: commitOid })
  const rootTree = await git.readTree({ fs, dir, gitdir, oid: commit.tree })

  const walk = async (tree, prefix) => {
    const nodes = []
    const sorted = [...tree.tree].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'tree' ? -1 : 1
      }
      return a.path.localeCompare(b.path)
    })
    for (const entry of sorted) {
      const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'tree') {
        const subtree = await git.readTree({ fs, dir, gitdir, oid: entry.oid })
        nodes.push({
          path: entryPath,
          name: entry.path,
          type: entry.type,
          children: await walk(subtree, entryPath),
        })
      } else {
        nodes.push({
          path: entryPath,
          name: entry.path,
          type: entry.type,
          children: [],
        })
      }
    }
    return nodes
  }

  return walk(rootTree, '')
}

const buildBlobIndex = async (fs, dir, gitdir, ref) => {
  const commitOid = await git.resolveRef({ fs, dir, gitdir, ref })
  const { commit } = await git.readCommit({ fs, dir, gitdir, oid: commitOid })
  const rootTree = await git.readTree({ fs, dir, gitdir, oid: commit.tree })
  const index = new Map()

  const walk = async (tree, prefix) => {
    for (const entry of tree.tree) {
      const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'blob') {
        index.set(entryPath, entry.oid)
      } else if (entry.type === 'tree') {
        const subtree = await git.readTree({ fs, dir, gitdir, oid: entry.oid })
        await walk(subtree, entryPath)
      }
    }
  }

  await walk(rootTree, '')
  return index
}

const readBlobByOid = async (fs, dir, gitdir, oid) => {
  if (!oid) {
    return ''
  }
  const { blob } = await git.readBlob({ fs, dir, gitdir, oid })
  return new TextDecoder().decode(blob)
}

const computeCompareData = async (fs, dir, gitdir, baseRef, compareRef) => {
  const baseIndex = await buildBlobIndex(fs, dir, gitdir, baseRef)
  const targetIndex = await buildBlobIndex(fs, dir, gitdir, compareRef)
  const paths = new Set([...baseIndex.keys(), ...targetIndex.keys()])
  const diffs = []
  for (const path of paths) {
    const baseOid = baseIndex.get(path) || null
    const targetOid = targetIndex.get(path) || null
    if (baseOid === targetOid) {
      continue
    }
    const status = !baseOid ? 'added' : !targetOid ? 'deleted' : 'modified'
    const baseText = await readBlobByOid(fs, dir, gitdir, baseOid)
    const targetText = await readBlobByOid(fs, dir, gitdir, targetOid)
    const diffLines = lcsDiff(baseText, targetText, path)
    diffs.push({
      path,
      lines: diffLines.slice(3),
      status,
    })
  }
  const compareCommitsList = await git.log({ fs, dir, gitdir, ref: compareRef })
  const baseCommitsList = await git.log({ fs, dir, gitdir, ref: baseRef })
  const baseOids = new Set(baseCommitsList.map((commit) => commit.oid))
  const uniqueCommits = compareCommitsList.filter(
    (commit) => !baseOids.has(commit.oid)
  )
  return { diffs, commits: uniqueCommits }
}

function RemoteRepoModal({
  isOpen,
  currentPath,
  canGoBack,
  canGoForward,
  refreshKey,
  onClose,
  onBack,
  onForward,
  onRefresh,
  onNavigate,
}) {
  const { fs } = useContext(FileSystemContext)
  const pfs = fs.promises
  const seededMergeRequestsRef = useRef(false)
  const [address, setAddress] = useState(`${BASE_URL}${currentPath}`)
  const [remoteState, setRemoteState] = useState({
    connected: false,
    branches: [],
    commits: [],
    defaultBranch: null,
  })
  const [selectedBranch, setSelectedBranch] = useState(null)
  const [remoteTree, setRemoteTree] = useState([])
  const [expandedFolders, setExpandedFolders] = useState(() => new Set())
  const [filePreview, setFilePreview] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [compareBase, setCompareBase] = useState(null)
  const [compareTarget, setCompareTarget] = useState(null)
  const [compareDiffs, setCompareDiffs] = useState([])
  const [compareCommits, setCompareCommits] = useState([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState(null)
  const [mergeRequests, setMergeRequests] = useState([])
  const [mrStatusFilter, setMrStatusFilter] = useState('open')
  const [mrDetail, setMrDetail] = useState({
    commits: [],
    diffs: [],
    loading: false,
    error: null,
    canMerge: false,
    baseOid: null,
    compareOid: null,
  })
  const [mrAction, setMrAction] = useState(null)
  const [deleteBranchOnMerge, setDeleteBranchOnMerge] = useState(false)
  const [mrMenuOpen, setMrMenuOpen] = useState(false)
  const [mrTitle, setMrTitle] = useState('')

  useEffect(() => {
    setAddress(`${BASE_URL}${currentPath}`)
  }, [currentPath, refreshKey])

  useEffect(() => {
    let cancelled = false
    const loadRemote = async () => {
      if (!isOpen) {
        return
      }
      const gitdir = `${REMOTE_PATH}/.git`
      let gitExists = false
      try {
        const stats = await pfs.stat(gitdir)
        gitExists = stats?.type === 'dir'
      } catch (error) {
        gitExists = false
      }
      if (!gitExists) {
        if (!cancelled) {
          setRemoteState({ connected: false, branches: [], commits: [] })
        }
        return
      }
      try {
        const branches = await git.listBranches({
          fs,
          dir: REMOTE_PATH,
          gitdir,
        })
        const defaultBranch = branches.includes('main') ? 'main' : branches[0] || null
        let commits = []
        if (defaultBranch) {
          commits = await git.log({
            fs,
            dir: REMOTE_PATH,
            gitdir,
            ref: defaultBranch,
          })
        }
        if (!cancelled) {
          setRemoteState({
            connected: true,
            branches,
            commits,
            defaultBranch,
          })
          setSelectedBranch((prev) => prev || defaultBranch)
          setCompareBase((prev) => prev || defaultBranch)
          setCompareTarget((prev) => {
            if (prev) {
              return prev
            }
            const fallback = branches.find((branch) => branch !== defaultBranch) || defaultBranch
            return fallback
          })
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteState({ connected: true, branches: [], commits: [], defaultBranch: null })
        }
      }
    }
    loadRemote()
    return () => {
      cancelled = true
    }
  }, [fs, isOpen, pfs, refreshKey])

  useEffect(() => {
    let cancelled = false
    const loadSeedMergeRequests = async () => {
      if (!isOpen || !remoteState.connected || seededMergeRequestsRef.current) {
        return
      }
      const metadataPath = `${REMOTE_PATH}/.edu_git_remote.json`
      try {
        const content = await pfs.readFile(metadataPath, 'utf8')
        if (!content) {
          return
        }
        const data = JSON.parse(content)
        if (!data?.mergeRequests || data.mergeRequests.length === 0) {
          return
        }
        if (cancelled) {
          return
        }
        seededMergeRequestsRef.current = true
        setMergeRequests((prev) => {
          if (prev.length > 0) {
            return prev
          }
          return data.mergeRequests.map((mr) => ({
            id: mr.id || `${mr.slug || mr.title}-${Date.now()}`,
            title: mr.title || 'Merge Request',
            slug: mr.slug || 'merge_request',
            status: mr.status || 'open',
            base: mr.base || 'main',
            compare: mr.compare || 'main',
          }))
        })
      } catch (error) {
        if (!cancelled) {
          seededMergeRequestsRef.current = true
        }
      }
    }
    loadSeedMergeRequests()
    return () => {
      cancelled = true
    }
  }, [isOpen, pfs, remoteState.connected])

  useEffect(() => {
    if (!mrMenuOpen) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.remote-repo-modal__mr-menu')) {
        setMrMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [mrMenuOpen])

  useEffect(() => {
    if (!mrAction) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.remote-repo-modal__mr-confirm')) {
        setMrAction(null)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [mrAction])

  useEffect(() => {
    let cancelled = false
    const loadTree = async () => {
      if (!isOpen || !remoteState.connected || !selectedBranch) {
        if (!cancelled) {
          setRemoteTree([])
        }
        return
      }
      const gitdir = `${REMOTE_PATH}/.git`
      try {
        const treeEntries = await buildRemoteTree(fs, REMOTE_PATH, gitdir, selectedBranch)
        if (!cancelled) {
          setRemoteTree(treeEntries)
          setExpandedFolders(new Set())
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteTree([])
          setExpandedFolders(new Set())
        }
      }
    }
    loadTree()
    return () => {
      cancelled = true
    }
  }, [fs, isOpen, remoteState.connected, selectedBranch])

  const page = useMemo(
    () => PAGES.find((entry) => entry.path === currentPath) || null,
    [currentPath]
  )
  const fileRoute = useMemo(
    () => parseFilePath(currentPath, remoteState.branches),
    [currentPath, remoteState.branches]
  )
  const mrRoute = useMemo(() => parseMrPath(currentPath), [currentPath])
  const activeMr = useMemo(
    () => mergeRequests.find((mr) => mr.slug === mrRoute) || null,
    [mergeRequests, mrRoute]
  )
  const hasOpenCompareMr = useMemo(
    () =>
      mergeRequests.some(
        (mr) =>
          mr.status === 'open' &&
          mr.base === compareBase &&
          mr.compare === compareTarget
      ),
    [compareBase, compareTarget, mergeRequests]
  )

  useEffect(() => {
    let cancelled = false
    const loadMrDetail = async () => {
      if (!isOpen || !mrRoute || !activeMr) {
        if (!cancelled) {
          setMrDetail({
            commits: [],
            diffs: [],
            loading: false,
            error: null,
            canMerge: false,
            baseOid: null,
            compareOid: null,
          })
        }
        return
      }
      const gitdir = `${REMOTE_PATH}/.git`
      if (
        activeMr.commits &&
        activeMr.diffs &&
        activeMr.canMerge !== undefined &&
        activeMr.baseOid &&
        activeMr.compareOid
      ) {
        if (!cancelled) {
          setMrDetail({
            commits: activeMr.commits,
            diffs: activeMr.diffs,
            loading: false,
            error: null,
            canMerge: activeMr.status === 'open' && activeMr.canMerge,
            baseOid: activeMr.baseOid || null,
            compareOid: activeMr.compareOid || null,
          })
        }
        return
      }
      setMrDetail((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const { diffs, commits } = await computeCompareData(
          fs,
          REMOTE_PATH,
          gitdir,
          activeMr.base,
          activeMr.compare
        )
        const baseOid = await git.resolveRef({
          fs,
          dir: REMOTE_PATH,
          gitdir,
          ref: activeMr.base,
        })
        const compareOid = await git.resolveRef({
          fs,
          dir: REMOTE_PATH,
          gitdir,
          ref: activeMr.compare,
        })
        const canMerge = Boolean(compareOid && baseOid && compareOid !== baseOid)
        if (!cancelled) {
          setMrDetail({
            diffs,
            commits,
            loading: false,
            error: null,
            canMerge,
            baseOid,
            compareOid,
          })
          setMergeRequests((prev) =>
            prev.map((mr) =>
              mr.id === activeMr.id
                ? { ...mr, diffs, commits, canMerge, baseOid, compareOid }
                : mr
            )
          )
        }
      } catch (error) {
        if (!cancelled) {
          setMrDetail({
            commits: [],
            diffs: [],
            loading: false,
            error: 'Unable to load MR.',
            canMerge: false,
            baseOid: null,
            compareOid: null,
          })
        }
      }
    }
    loadMrDetail()
    return () => {
      cancelled = true
    }
  }, [activeMr, fs, isOpen, mrRoute])

  useEffect(() => {
    let cancelled = false
    const loadFile = async () => {
      if (!isOpen || !fileRoute) {
        if (!cancelled) {
          setFilePreview(null)
          setFileError(null)
        }
        return
      }
      const gitdir = `${REMOTE_PATH}/.git`
      try {
        const commitOid = await git.resolveRef({
          fs,
          dir: REMOTE_PATH,
          gitdir,
          ref: fileRoute.branch,
        })
        const { commit } = await git.readCommit({
          fs,
          dir: REMOTE_PATH,
          gitdir,
          oid: commitOid,
        })
        const parts = fileRoute.filePath.split('/')
        let currentTree = commit.tree
        for (let index = 0; index < parts.length; index += 1) {
          const part = parts[index]
          const { tree } = await git.readTree({
            fs,
            dir: REMOTE_PATH,
            gitdir,
            oid: currentTree,
          })
          const entry = tree.find((item) => item.path === part)
          if (!entry) {
            throw new Error('File not found')
          }
          if (index === parts.length - 1) {
            if (entry.type !== 'blob') {
              throw new Error('Not a file')
            }
            const { blob } = await git.readBlob({
              fs,
              dir: REMOTE_PATH,
              gitdir,
              oid: entry.oid,
            })
            const content = new TextDecoder().decode(blob)
            if (!cancelled) {
              setFilePreview({
                branch: fileRoute.branch,
                path: fileRoute.filePath,
                content,
              })
              setFileError(null)
            }
            return
          }
          if (entry.type !== 'tree') {
            throw new Error('Invalid path')
          }
          currentTree = entry.oid
        }
      } catch (error) {
        if (!cancelled) {
          setFilePreview(null)
          setFileError('404')
        }
      }
    }
    loadFile()
    return () => {
      cancelled = true
    }
  }, [fileRoute, fs, isOpen])

  useEffect(() => {
    let cancelled = false
    const loadCompare = async () => {
      if (
        !isOpen ||
        !remoteState.connected ||
        !compareBase ||
        !compareTarget ||
        compareBase === compareTarget
      ) {
        if (!cancelled) {
          setCompareDiffs([])
        }
        return
      }
      setCompareLoading(true)
      setCompareError(null)
      const gitdir = `${REMOTE_PATH}/.git`
      try {
        const { diffs, commits } = await computeCompareData(
          fs,
          REMOTE_PATH,
          gitdir,
          compareBase,
          compareTarget
        )
        if (!cancelled) {
          setCompareDiffs(diffs)
          setCompareCommits(commits)
        }
      } catch (error) {
        if (!cancelled) {
          setCompareError('Unable to compare branches.')
          setCompareCommits([])
        }
      } finally {
        if (!cancelled) {
          setCompareLoading(false)
        }
      }
    }
    loadCompare()
    return () => {
      cancelled = true
    }
  }, [compareBase, compareTarget, fs, isOpen, remoteState.connected])

  useEffect(() => {
    let cancelled = false
    const loadCommits = async () => {
      if (!isOpen || !remoteState.connected || !selectedBranch) {
        return
      }
      const gitdir = `${REMOTE_PATH}/.git`
      try {
        const commits = await git.log({
          fs,
          dir: REMOTE_PATH,
          gitdir,
          ref: selectedBranch,
        })
        if (!cancelled) {
          setRemoteState((prev) => ({ ...prev, commits }))
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteState((prev) => ({ ...prev, commits: [] }))
        }
      }
    }
    loadCommits()
    return () => {
      cancelled = true
    }
  }, [fs, isOpen, remoteState.connected, selectedBranch])

  const TreeRow = ({ node, depth, expandedFolders, onToggle }) => {
    const isFolder = node.type === 'tree'
    const isOpen = isFolder ? expandedFolders.has(node.path) : false
    return (
      <>
        <div
          className={`remote-repo-modal__tree-row ${
            isFolder ? 'remote-repo-modal__tree-row--folder' : ''
          }`}
          style={{ paddingLeft: `${depth * 16}px` }}
          onClick={() => {
            if (isFolder) {
              onToggle(node.path)
              return
            }
            if (!selectedBranch) {
              return
            }
            const route = buildFilePath(selectedBranch, node.path)
            onNavigate(route)
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return
            }
            event.preventDefault()
            if (isFolder) {
              event.preventDefault()
              onToggle(node.path)
              return
            }
            if (!selectedBranch) {
              return
            }
            const route = buildFilePath(selectedBranch, node.path)
            onNavigate(route)
          }}
        >
          <span className="remote-repo-modal__tree-icon" aria-hidden="true">
            {isFolder ? (isOpen ? '📂' : '📁') : '📄'}
          </span>
          <span>{node.name}</span>
        </div>
        {isFolder && isOpen
          ? node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                onToggle={onToggle}
              />
            ))
          : null}
      </>
    )
  }

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="remote-repo-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="remote-repo-modal" role="dialog" aria-modal="true">
        <div className="remote-repo-modal__chrome">
          <div className="remote-repo-modal__nav">
            <button
              type="button"
              className="remote-repo-modal__nav-btn"
              onClick={onBack}
              disabled={!canGoBack}
              aria-label="Back"
            >
              ←
            </button>
            <button
              type="button"
              className="remote-repo-modal__nav-btn"
              onClick={onForward}
              disabled={!canGoForward}
              aria-label="Forward"
            >
              →
            </button>
          </div>
          <form
            className="remote-repo-modal__address"
            onSubmit={(event) => {
              event.preventDefault()
              const nextPath = normalizePath(address).replace(/^\/edu-git/, '')
              onNavigate(nextPath)
            }}
          >
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="remote-repo-modal__address-input"
              spellCheck="false"
            />
          </form>
          <button type="button" className="remote-repo-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="remote-repo-modal__body">
          <aside className="remote-repo-modal__sidebar">
            <div className="remote-repo-modal__repo">
              <div className="remote-repo-modal__repo-name">edu-git</div>
              <div className="remote-repo-modal__repo-meta">Remote Repo UI</div>
              <div
                className={`remote-repo-modal__badge ${
                  remoteState.connected ? 'remote-repo-modal__badge--linked' : ''
                }`}
              >
                {remoteState.connected ? `Linked: ${REMOTE_NAME}` : 'No remote linked'}
              </div>
            </div>
            <nav className="remote-repo-modal__menu">
              {PAGES.filter((entry) => {
                if (!remoteState.connected) {
                  return entry.path === '/'
                }
                if (entry.path === '/merge-requests') {
                  return mergeRequests.length > 0
                }
                if (entry.path === '/compare') {
                  return remoteState.branches.length > 1
                }
                return true
              }).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`remote-repo-modal__menu-item ${
                    currentPath === entry.path ? 'is-active' : ''
                  }`}
                  onClick={() => onNavigate(entry.path)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>
          </aside>

          <main className="remote-repo-modal__content">
            {page?.path === '/' && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2>Remote Overview</h2>
                  {remoteState.connected ? (
                    <label className="remote-repo-modal__select">
                      <span>Branch</span>
                      <select
                        value={selectedBranch || ''}
                        onChange={(event) => setSelectedBranch(event.target.value)}
                      >
                        {remoteState.branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p>
                  {remoteState.connected
                    ? 'This remote repo is linked and ready to receive pushes.'
                    : 'This remote repo is not connected yet. Link your local repo to remote.mock/edu-git to sync changes.'}
                </p>
                {remoteState.connected ? (
                  <div className="remote-repo-modal__card">
                    <h3>Repository tree</h3>
                    {remoteTree.length === 0 ? (
                      <div className="remote-repo-modal__empty">No files found.</div>
                    ) : (
                      <div className="remote-repo-modal__tree">
                        {remoteTree.map((entry) => (
                          <TreeRow
                            key={entry.path}
                            node={entry}
                            depth={0}
                            expandedFolders={expandedFolders}
                            onToggle={(path) => {
                              setExpandedFolders((prev) => {
                                const next = new Set(prev)
                                if (next.has(path)) {
                                  next.delete(path)
                                } else {
                                  next.add(path)
                                }
                                return next
                              })
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                {!remoteState.connected ? (
                  <>
                    <div className="remote-repo-modal__card">
                      <h3>Initialize your repo</h3>
                      <pre>git init</pre>
                      <pre>git add .</pre>
                      <pre>git commit -m &quot;init&quot;</pre>
                    </div>
                    <div className="remote-repo-modal__card">
                      <h3>Connect to remote</h3>
                      <pre>git remote add origin {BASE_URL}</pre>
                      <pre>git push -u origin main</pre>
                    </div>
                  </>
                ) : null}
              </>
            )}
            {page?.path === '/branches' && !fileRoute && (
              <>
                <h2>Branches</h2>
                {remoteState.branches.length === 0 ? (
                  <>
                    <p>No remote branches yet. Connect a local repo to populate branches.</p>
                    <div className="remote-repo-modal__empty">No branches</div>
                  </>
                ) : (
                  <div className="remote-repo-modal__list">
                    {remoteState.branches.map((branch) => (
                      <div key={branch} className="remote-repo-modal__list-item">
                        {branch}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {page?.path === '/commits' && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2>Commits</h2>
                  {remoteState.connected ? (
                    <label className="remote-repo-modal__select">
                      <span>Branch</span>
                      <select
                        value={selectedBranch || ''}
                        onChange={(event) => setSelectedBranch(event.target.value)}
                      >
                        {remoteState.branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {remoteState.commits.length === 0 ? (
                  <>
                    <p>Once connected, commits pushed to the remote will appear here.</p>
                    <div className="remote-repo-modal__empty">No commits</div>
                  </>
                ) : (
                  <div className="remote-repo-modal__list">
                    {remoteState.commits.map((commit) => (
                      <div key={commit.oid} className="remote-repo-modal__list-item">
                        <div className="remote-repo-modal__commit-title">
                          {commit.commit.message.split('\n')[0]}
                        </div>
                        <div className="remote-repo-modal__commit-meta">
                          {commit.oid.slice(0, 7)} · {commit.commit.author.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {page?.path === '/compare' && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2>Compare</h2>
                </div>
                {remoteState.branches.length < 2 ? (
                  <div className="remote-repo-modal__empty">
                    Create another branch to compare.
                  </div>
                ) : (
                  <>
                    <div className="remote-repo-modal__compare-bar">
                      <label className="remote-repo-modal__select">
                        <span>Base</span>
                        <select
                          value={compareBase || ''}
                          onChange={(event) => setCompareBase(event.target.value)}
                        >
                          {remoteState.branches.map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="remote-repo-modal__select">
                        <span>Compare</span>
                        <select
                          value={compareTarget || ''}
                          onChange={(event) => setCompareTarget(event.target.value)}
                        >
                          {remoteState.branches.map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="remote-repo-modal__spacer" aria-hidden="true" />
                      <button
                        type="button"
                        className="remote-repo-modal__primary"
                        disabled={
                          compareBase === compareTarget ||
                          hasOpenCompareMr ||
                          compareLoading ||
                          compareDiffs.length === 0
                        }
                        title={
                          hasOpenCompareMr
                            ? 'You already have a request for this change.'
                            : compareDiffs.length === 0
                              ? 'There are no changes to request.'
                              : ''
                        }
                        onClick={() => setMrMenuOpen((prev) => !prev)}
                      >
                        Create Merge Request {compareTarget} → {compareBase}
                      </button>
                    </div>
                    {mrMenuOpen ? (
                      <div className="remote-repo-modal__mr-menu">
                        <label className="remote-repo-modal__mr-field">
                          <span>Merge Request title</span>
                          <input
                            type="text"
                            value={mrTitle}
                            onChange={(event) => setMrTitle(event.target.value)}
                            placeholder="Add a title"
                          />
                        </label>
                        <div className="remote-repo-modal__mr-actions">
                          <button
                            type="button"
                            className="remote-repo-modal__mr-create"
                            disabled={!mrTitle.trim()}
                            onClick={() => {
                              const title = mrTitle.trim()
                              if (!title) {
                                return
                              }
                              const slug = slugifyTitle(title)
                              setMergeRequests((prev) => [
                                {
                                  id: `${slug}-${Date.now()}`,
                                  title,
                                  slug,
                                  status: 'open',
                                  base: compareBase,
                                  compare: compareTarget,
                                  commits: compareCommits,
                                  diffs: compareDiffs,
                                },
                                ...prev,
                              ])
                              setMrTitle('')
                              setMrMenuOpen(false)
                              onNavigate(`/mr/${slug}`)
                            }}
                          >
                            Create
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {compareBase === compareTarget ? (
                      <div className="remote-repo-modal__empty">
                        Select two different branches to compare.
                      </div>
                    ) : compareLoading ? (
                      <div className="remote-repo-modal__empty">Comparing branches...</div>
                    ) : compareError ? (
                      <div className="remote-repo-modal__empty">{compareError}</div>
                    ) : compareDiffs.length === 0 ? (
                      <div className="remote-repo-modal__empty">
                        No differences found between these branches.
                      </div>
                    ) : (
                      <div className="remote-repo-modal__compare-list">
                        {compareDiffs.map((diff) => (
                          <div key={diff.path} className="remote-repo-modal__diff-card">
                            <div className="remote-repo-modal__diff-header">
                              <div className="remote-repo-modal__diff-title">{diff.path}</div>
                              <span
                                className={`remote-repo-modal__diff-badge remote-repo-modal__diff-badge--${diff.status}`}
                              >
                                {diff.status}
                              </span>
                            </div>
                            <pre className="remote-repo-modal__diff-body">
                              {diff.lines.map((line, index) => (
                                <span
                                  key={`${diff.path}-${index}`}
                                  className={
                                    line.startsWith('+ ')
                                      ? 'remote-repo-modal__diff-line--add'
                                      : line.startsWith('- ')
                                        ? 'remote-repo-modal__diff-line--del'
                                        : 'remote-repo-modal__diff-line--ctx'
                                  }
                                >
                                  {line}
                                  {'\n'}
                                </span>
                              ))}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {page?.path === '/merge-requests' && !fileRoute && !mrRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2>Merge Requests</h2>
                  <label className="remote-repo-modal__select">
                    <span>Status</span>
                    <select
                      value={mrStatusFilter}
                      onChange={(event) => setMrStatusFilter(event.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                      <option value="merged">Merged</option>
                    </select>
                  </label>
                </div>
                {mergeRequests.filter((mr) => mr.status === mrStatusFilter).length === 0 ? (
                  <div className="remote-repo-modal__empty">No merge requests.</div>
                ) : (
                  <div className="remote-repo-modal__mr-table">
                    <div className="remote-repo-modal__mr-row remote-repo-modal__mr-row--header">
                      <span>Title</span>
                      <span>Branches</span>
                      <span>Status</span>
                    </div>
                    {mergeRequests
                      .filter((mr) => mr.status === mrStatusFilter)
                      .map((mr) => (
                        <button
                          type="button"
                          key={mr.id}
                          className="remote-repo-modal__mr-row"
                          onClick={() => onNavigate(`/mr/${mr.slug}`)}
                        >
                          <span>{mr.title}</span>
                          <span>
                            {mr.compare} → {mr.base}
                          </span>
                          <span className="remote-repo-modal__mr-status">{mr.status}</span>
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
            {mrRoute && activeMr && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <div className="remote-repo-modal__mr-title">
                    <h2>{activeMr.title}</h2>
                    {activeMr.status === 'merged' ? (
                      <span className="remote-repo-modal__mr-chip">Merged</span>
                    ) : null}
                  </div>
                  {activeMr.status === 'open' ? (
                    <div className="remote-repo-modal__mr-actions">
                      <button
                        type="button"
                        className="remote-repo-modal__mr-button remote-repo-modal__mr-button--merge"
                        disabled={!mrDetail.canMerge}
                        title={
                          !mrDetail.canMerge ? 'This merge request cannot be merged yet.' : ''
                        }
                        onClick={() => setMrAction('merge')}
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        className="remote-repo-modal__mr-button remote-repo-modal__mr-button--close"
                        onClick={() => setMrAction('close')}
                      >
                        Close
                      </button>
                    </div>
                  ) : null}
                </div>
                {mrAction ? (
                  <div className="remote-repo-modal__mr-confirm">
                    <div className="remote-repo-modal__mr-confirm-title">
                      {mrAction === 'merge' ? 'Merge this request?' : 'Close this request?'}
                    </div>
                    <div className="remote-repo-modal__mr-confirm-text">
                      {mrAction === 'merge'
                        ? `This will update ${activeMr.base} to ${activeMr.compare} and mark the request as merged.`
                        : 'This will close the merge request without merging changes.'}
                    </div>
                    <div className="remote-repo-modal__mr-confirm-actions">
                      {mrAction === 'merge' ? (
                        <label className="remote-repo-modal__mr-confirm-toggle">
                          <input
                            type="checkbox"
                            checked={deleteBranchOnMerge}
                            onChange={(event) => setDeleteBranchOnMerge(event.target.checked)}
                          />
                          Delete branch {activeMr.compare} on merge
                        </label>
                      ) : null}
                      <div className="remote-repo-modal__mr-confirm-spacer" aria-hidden="true" />
                      <button
                        type="button"
                        className="remote-repo-modal__mr-confirm-cancel"
                        onClick={() => {
                          setMrAction(null)
                          setDeleteBranchOnMerge(false)
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`remote-repo-modal__mr-confirm-apply ${
                          mrAction === 'merge'
                            ? 'remote-repo-modal__mr-confirm-apply--merge'
                            : 'remote-repo-modal__mr-confirm-apply--close'
                        }`}
                      onClick={async () => {
                        if (mrAction === 'merge') {
                          if (!mrDetail.canMerge || !mrDetail.compareOid) {
                            setMrAction(null)
                            setDeleteBranchOnMerge(false)
                            return
                          }
                          const gitdir = `${REMOTE_PATH}/.git`
                          await git.writeRef({
                            fs,
                            dir: REMOTE_PATH,
                            gitdir,
                            ref: `refs/heads/${activeMr.base}`,
                            value: mrDetail.compareOid,
                            force: true,
                          })
                          if (
                            deleteBranchOnMerge &&
                            activeMr.compare &&
                            activeMr.compare !== activeMr.base
                          ) {
                            try {
                              await git.deleteRef({
                                fs,
                                dir: REMOTE_PATH,
                                gitdir,
                                ref: `refs/heads/${activeMr.compare}`,
                              })
                              setRemoteState((prev) => {
                                const updatedBranches = prev.branches.filter(
                                  (branch) => branch !== activeMr.compare
                                )
                                const nextDefault =
                                  prev.defaultBranch && updatedBranches.includes(prev.defaultBranch)
                                    ? prev.defaultBranch
                                    : updatedBranches[0] || null
                                return {
                                  ...prev,
                                  branches: updatedBranches,
                                  defaultBranch: nextDefault,
                                }
                              })
                              setSelectedBranch((prev) =>
                                prev === activeMr.compare ? activeMr.base : prev
                              )
                              setCompareBase((prev) =>
                                prev === activeMr.compare ? activeMr.base : prev
                              )
                              setCompareTarget((prev) =>
                                prev === activeMr.compare ? activeMr.base : prev
                              )
                            } catch (error) {
                              // Ignore delete failures to keep merge flow smooth.
                            }
                          }
                          setMergeRequests((prev) =>
                            prev.map((mr) =>
                              mr.id === activeMr.id
                                ? {
                                    ...mr,
                                    status: 'merged',
                                    commits: mrDetail.commits,
                                    diffs: mrDetail.diffs,
                                  }
                                : mr
                            )
                          )
                        } else {
                          setMergeRequests((prev) =>
                            prev.map((mr) =>
                              mr.id === activeMr.id
                                ? {
                                    ...mr,
                                    status: 'closed',
                                    commits: mrDetail.commits,
                                    diffs: mrDetail.diffs,
                                  }
                                : mr
                            )
                          )
                        }
                          setMrAction(null)
                          setDeleteBranchOnMerge(false)
                        }}
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="remote-repo-modal__mr-summary">
                  {activeMr.base} ← {activeMr.compare}
                </div>
                <div className="remote-repo-modal__mr-section">
                  <h3>Commits</h3>
                  {mrDetail.loading ? (
                    <div className="remote-repo-modal__empty">Loading merge request...</div>
                  ) : mrDetail.error ? (
                    <div className="remote-repo-modal__empty">{mrDetail.error}</div>
                  ) : mrDetail.commits.length === 0 ? (
                    <div className="remote-repo-modal__empty">No commits found.</div>
                  ) : (
                    <div className="remote-repo-modal__list">
                      {mrDetail.commits.map((commit) => (
                        <div key={commit.oid} className="remote-repo-modal__list-item">
                          <div className="remote-repo-modal__commit-title">
                            {commit.commit.message.split('\n')[0]}
                          </div>
                          <div className="remote-repo-modal__commit-meta">
                            {commit.oid.slice(0, 7)} · {commit.commit.author.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="remote-repo-modal__mr-section">
                  <h3>Diff</h3>
                  {mrDetail.loading ? (
                    <div className="remote-repo-modal__empty">Loading merge request...</div>
                  ) : mrDetail.error ? (
                    <div className="remote-repo-modal__empty">{mrDetail.error}</div>
                  ) : mrDetail.diffs.length === 0 ? (
                    <div className="remote-repo-modal__empty">
                      No differences found between these branches.
                    </div>
                  ) : (
                    <div className="remote-repo-modal__compare-list">
                      {mrDetail.diffs.map((diff) => (
                        <div key={diff.path} className="remote-repo-modal__diff-card">
                          <div className="remote-repo-modal__diff-header">
                            <div className="remote-repo-modal__diff-title">{diff.path}</div>
                            <span
                              className={`remote-repo-modal__diff-badge remote-repo-modal__diff-badge--${diff.status}`}
                            >
                              {diff.status}
                            </span>
                          </div>
                          <pre className="remote-repo-modal__diff-body">
                            {diff.lines.map((line, index) => (
                              <span
                                key={`${diff.path}-${index}`}
                                className={
                                  line.startsWith('+ ')
                                    ? 'remote-repo-modal__diff-line--add'
                                    : line.startsWith('- ')
                                      ? 'remote-repo-modal__diff-line--del'
                                      : 'remote-repo-modal__diff-line--ctx'
                                }
                              >
                                {line}
                                {'\n'}
                              </span>
                            ))}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {mrRoute && !activeMr && !fileRoute && (
              <div className="remote-repo-modal__notfound">
                <div className="remote-repo-modal__notfound-code">404</div>
                <div className="remote-repo-modal__notfound-title">Merge Request not found</div>
                <div className="remote-repo-modal__notfound-text">
                  This merge request does not exist in the current workspace.
                </div>
              </div>
            )}
            {fileRoute && (
              <div className="remote-repo-modal__file-view">
                <div className="remote-repo-modal__header">
                  <h2>{filePreview?.path || fileRoute.filePath}</h2>
                  <label className="remote-repo-modal__select">
                    <span>Branch</span>
                    <select
                      value={fileRoute.branch}
                      onChange={(event) => {
                        const nextBranch = event.target.value
                        const nextRoute = buildFilePath(nextBranch, fileRoute.filePath)
                        onNavigate(nextRoute)
                        setSelectedBranch(nextBranch)
                      }}
                    >
                      {remoteState.branches.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="remote-repo-modal__file-path">
                  {fileRoute.branch}:{fileRoute.filePath}
                </div>
                {fileError ? (
                  <div className="remote-repo-modal__file-empty">
                    <div className="remote-repo-modal__file-code">404</div>
                    <div className="remote-repo-modal__file-title">Not Found</div>
                    <div className="remote-repo-modal__file-text">
                      The file could not be found on this branch.
                    </div>
                  </div>
                ) : (
                  <pre className="remote-repo-modal__file-content">
                    {filePreview ? filePreview.content : 'Loading...'}
                  </pre>
                )}
              </div>
            )}
            {!page && !fileRoute && !mrRoute && (
              <div className="remote-repo-modal__notfound">
                <div className="remote-repo-modal__notfound-code">404</div>
                <div className="remote-repo-modal__notfound-title">Page not found</div>
                <div className="remote-repo-modal__notfound-text">
                  Use the sidebar to navigate to a valid section.
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default RemoteRepoModal
