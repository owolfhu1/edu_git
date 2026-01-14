import { useContext, useEffect, useMemo, useState } from 'react'
import git from 'isomorphic-git'
import './RemoteRepoModal.css'
import { FileSystemContext } from '../../store/FileSystemContext'

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

const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/branches', label: 'Branches' },
  { path: '/commits', label: 'Commits' },
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
              {PAGES.filter((entry) =>
                remoteState.connected ? true : entry.path === '/'
              ).map((entry) => (
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
            {!page && !fileRoute && (
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
