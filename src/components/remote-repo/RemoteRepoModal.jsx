import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import './RemoteRepoModal.css'
import { FileSystemContext } from '../../store/FileSystemContext'
import { lcsDiff } from '../../git/diff'
import { FileIcon, FolderClosedIcon, FolderOpenIcon } from '../icons/FileIcons'

const BASE_URL = 'https://remote.mock'
const MERGE_AUTHOR = { name: 'Edu Git', email: 'edu@example.com' }
const REMOTE_NAME = 'origin'
const REMOTE_ROOT = '/.remotes'
const IGNORED_COMPARE_PREFIXES = ['.remotes/', '.git/']
const IGNORED_COMPARE_FILES = new Set(['.edu_git_remote.json'])

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

const parseRepoRoute = (path) => {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return { repo: null, subPath: '/', isHome: true }
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { repo: null, subPath: '/', isHome: true }
  }
  const [repo, ...rest] = segments
  return {
    repo,
    subPath: `/${rest.join('/')}`,
    isHome: false,
  }
}

const buildRepoPath = (repo, subPath) => `/${repo}${subPath}`

const slugifyTitle = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const getMergeability = async (fs, dir, gitdir, baseRef, compareRef) => {
  try {
    const result = await git.merge({
      fs,
      dir,
      gitdir,
      ours: baseRef,
      theirs: compareRef,
      dryRun: true,
      fastForward: true,
      fastForwardOnly: false,
      abortOnConflict: true,
      author: MERGE_AUTHOR,
      committer: MERGE_AUTHOR,
    })
    if (result?.alreadyMerged) {
      return { status: 'already-merged', canMerge: false, conflictFiles: [] }
    }
    return { status: 'clean', canMerge: true, conflictFiles: [] }
  } catch (error) {
    if (error?.code === 'MergeConflictError' || error?.code === 'MergeNotSupportedError') {
      return {
        status: 'conflict',
        canMerge: false,
        conflictFiles: error?.data?.filepaths || [],
      }
    }
    return {
      status: 'error',
      canMerge: false,
      conflictFiles: [],
      message: error?.message || 'Unable to determine merge status.',
    }
  }
}

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

const CONFLICT_STRATEGIES = [
  { id: 'merge', label: 'Merge (default)' },
  { id: 'rebase', label: 'Rebase' },
  { id: 'cherry-pick', label: 'Cherry-pick' },
]

const buildConflictCommands = (strategy, baseBranch, compareBranch) => {
  switch (strategy) {
    case 'rebase':
      return [
        `git checkout ${compareBranch}`,
        `git fetch origin`,
        `git rebase origin/${baseBranch}`,
        '# fix conflicts in your editor',
        'git add .',
        'git rebase --continue',
        `git push --force-with-lease origin ${compareBranch}`,
      ]
    case 'cherry-pick':
      return [
        `git checkout ${baseBranch}`,
        `git pull origin ${baseBranch}`,
        `git checkout -b ${compareBranch}_resolved`,
        'git cherry-pick <commit_sha>',
        '# fix conflicts if any',
        'git add .',
        'git cherry-pick --continue',
        `git push origin ${compareBranch}_resolved`,
      ]
    default:
      return [
        `git checkout ${compareBranch}`,
        `git pull origin ${baseBranch}`,
        '# fix conflicts in your editor',
        'git add .',
        'git commit',
        `git push origin ${compareBranch}`,
      ]
  }
}

const buildConflictExplanation = (strategy, baseBranch, compareBranch) => {
  switch (strategy) {
    case 'rebase':
      return `Rebase rewrites ${compareBranch} so its commits sit on top of ${baseBranch}, producing a linear history and smaller diffs during review. Use this when you want a clean commit graph and you are comfortable force-pushing updated history.`
    case 'cherry-pick':
      return `Cherry-pick moves a specific commit onto ${baseBranch} by creating a new branch with only the change you want. Use this when you need just one fix without bringing in the rest of ${compareBranch}.`
    default:
      return `Merge preserves the full history of ${compareBranch} and records a dedicated merge commit. Use this when you want the safest path that keeps all context and avoids rewriting history.`
  }
}

const isBranchPairTaken = (mergeRequests, baseBranch, compareBranch, excludeId) =>
  mergeRequests.some(
    (mr) =>
      mr.status === 'open' &&
      mr.id !== excludeId &&
      mr.base === baseBranch &&
      mr.compare === compareBranch
  )

const copyDir = async (pfs, source, destination) => {
  await pfs.mkdir(destination)
  const entries = await pfs.readdir(source)
  for (const entry of entries) {
    const fromPath = `${source}/${entry}`
    const toPath = `${destination}/${entry}`
    const stats = await pfs.stat(fromPath)
    if (stats.type === 'dir') {
      await copyDir(pfs, fromPath, toPath)
    } else {
      const content = await pfs.readFile(fromPath)
      await pfs.writeFile(toPath, content)
    }
  }
}

const cloneIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <rect x="8" y="2" width="12" height="12" rx="2" />
  </svg>
)

const forkIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="18" r="2" />
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M12 16V12a2 2 0 0 0-2-2H8M12 12a2 2 0 0 1 2-2h2" />
    <path d="M6 8v2M18 8v2" />
  </svg>
)

const deleteIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

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

const buildBlobIndex = async (fs, dir, gitdir, refOrOid) => {
  if (!refOrOid) {
    return new Map()
  }
  const commitOid = refOrOid.includes('/')
    ? await git.resolveRef({ fs, dir, gitdir, ref: refOrOid })
    : refOrOid
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

const findMergeBase = async (fs, dir, gitdir, baseOid, compareOid) => {
  if (!baseOid || !compareOid) {
    return null
  }
  if (baseOid === compareOid) {
    return baseOid
  }
  const baseAncestors = new Set()
  const baseQueue = [baseOid]
  while (baseQueue.length > 0) {
    const oid = baseQueue.shift()
    if (baseAncestors.has(oid)) {
      continue
    }
    baseAncestors.add(oid)
    const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
    if (commit.parent?.length) {
      baseQueue.push(...commit.parent)
    }
  }
  const compareQueue = [compareOid]
  const seenCompare = new Set()
  while (compareQueue.length > 0) {
    const oid = compareQueue.shift()
    if (seenCompare.has(oid)) {
      continue
    }
    if (baseAncestors.has(oid)) {
      return oid
    }
    seenCompare.add(oid)
    const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
    if (commit.parent?.length) {
      compareQueue.push(...commit.parent)
    }
  }
  return null
}

const readBlobByOid = async (fs, dir, gitdir, oid) => {
  if (!oid) {
    return ''
  }
  const { blob } = await git.readBlob({ fs, dir, gitdir, oid })
  return new TextDecoder().decode(blob)
}

const shouldIgnoreComparePath = (path) => {
  if (IGNORED_COMPARE_FILES.has(path)) {
    return true
  }
  return IGNORED_COMPARE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

const dedupeCommits = (commits) => {
  const seen = new Set()
  return commits.filter((commit) => {
    if (seen.has(commit.oid)) {
      return false
    }
    seen.add(commit.oid)
    return true
  })
}

const computeCompareData = async (fs, dir, gitdir, baseRef, compareRef) => {
  const baseOid = await git.resolveRef({ fs, dir, gitdir, ref: baseRef })
  const compareOid = await git.resolveRef({ fs, dir, gitdir, ref: compareRef })
  const mergeBaseOid = await findMergeBase(fs, dir, gitdir, baseOid, compareOid)
  const baseIndex = await buildBlobIndex(fs, dir, gitdir, mergeBaseOid || baseOid)
  const targetIndex = await buildBlobIndex(fs, dir, gitdir, compareOid)
  const paths = new Set([...baseIndex.keys(), ...targetIndex.keys()])
  const diffs = []
  for (const path of paths) {
    if (shouldIgnoreComparePath(path)) {
      continue
    }
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
  return { diffs, commits: dedupeCommits(uniqueCommits) }
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
  const [remoteRepos, setRemoteRepos] = useState([])
  const [createRepoOpen, setCreateRepoOpen] = useState(false)
  const [createRepoName, setCreateRepoName] = useState('')
  const [createRepoError, setCreateRepoError] = useState('')
  const [repoMissing, setRepoMissing] = useState(false)
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
  const [commitRefreshToken, setCommitRefreshToken] = useState(0)
  const [cloneMenuOpen, setCloneMenuOpen] = useState(false)
  const [forkMenuOpen, setForkMenuOpen] = useState(false)
  const [forkName, setForkName] = useState('')
  const [forkError, setForkError] = useState('')
  const [deleteRepoOpen, setDeleteRepoOpen] = useState(false)
  const [remoteReadme, setRemoteReadme] = useState(null)
  const [mrDetail, setMrDetail] = useState({
    commits: [],
    diffs: [],
    loading: false,
    error: null,
    canMerge: false,
    baseOid: null,
    compareOid: null,
    mergeStatus: null,
    conflictFiles: [],
    mergeMessage: null,
    mergeRelation: null,
  })
  const [mrAction, setMrAction] = useState(null)
  const [deleteBranchOnMerge, setDeleteBranchOnMerge] = useState(false)
  const [mrMenuOpen, setMrMenuOpen] = useState(false)
  const [mrTitle, setMrTitle] = useState('')
  const [conflictStrategy, setConflictStrategy] = useState('merge')
  const mergeRequestsLoadedRef = useRef(false)

  const route = useMemo(() => parseRepoRoute(currentPath), [currentPath])
  const activeRepo = route.repo
  const repoPath = activeRepo ? `${REMOTE_ROOT}/${activeRepo}` : null
  const repoGitDir = repoPath ? `${repoPath}/.git` : null
  const repoSubPath = route.subPath || '/'
  const remoteUrl = activeRepo ? `${BASE_URL}/${activeRepo}` : `${BASE_URL}/<repo>`
  const navigateRepo = (path) => {
    if (!activeRepo) {
      onNavigate('/')
      return
    }
    onNavigate(buildRepoPath(activeRepo, path))
  }

  useEffect(() => {
    mergeRequestsLoadedRef.current = false
    seededMergeRequestsRef.current = false
    setMergeRequests([])
    setMrStatusFilter('open')
    setMrMenuOpen(false)
    setMrTitle('')
    setMrAction(null)
    setDeleteBranchOnMerge(false)
  }, [activeRepo])

  useEffect(() => {
    setAddress(`${BASE_URL}${currentPath}`)
  }, [currentPath, refreshKey])

  useEffect(() => {
    let cancelled = false
    const checkRepo = async () => {
      if (!isOpen || !activeRepo) {
        if (!cancelled) {
          setRepoMissing(false)
        }
        return
      }
      try {
        const stats = await pfs.stat(`${REMOTE_ROOT}/${activeRepo}`)
        if (!cancelled) {
          setRepoMissing(stats?.type !== 'dir')
        }
      } catch (error) {
        if (!cancelled) {
          setRepoMissing(true)
        }
      }
    }
    checkRepo()
    return () => {
      cancelled = true
    }
  }, [activeRepo, isOpen, pfs, refreshKey])

  useEffect(() => {
    let cancelled = false
    const loadRepos = async () => {
      if (!isOpen) {
        return
      }
      try {
        const entries = await pfs.readdir(REMOTE_ROOT)
        if (!cancelled) {
          setRemoteRepos(entries.filter((entry) => !entry.startsWith('.')).sort())
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteRepos([])
        }
      }
    }
    loadRepos()
    return () => {
      cancelled = true
    }
  }, [isOpen, pfs, refreshKey])

  useEffect(() => {
    let cancelled = false
    const loadRemote = async () => {
      if (!isOpen) {
        return
      }
      if (!activeRepo || !repoGitDir || !repoPath || repoMissing) {
        if (!cancelled) {
          setRemoteState({ connected: false, branches: [], commits: [] })
          setSelectedBranch(null)
          setCompareBase(null)
          setCompareTarget(null)
        }
        return
      }
      const gitdir = repoGitDir
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
          dir: repoPath,
          gitdir,
        })
        if (branches.length === 0) {
          if (!cancelled) {
            setRemoteState({ connected: false, branches: [], commits: [], defaultBranch: null })
            setSelectedBranch(null)
            setCompareBase(null)
            setCompareTarget(null)
          }
          return
        }
        const defaultBranch = branches.includes('main') ? 'main' : branches[0] || null
        let commits = []
        if (defaultBranch) {
          commits = await git.log({
            fs,
            dir: repoPath,
            gitdir,
            ref: defaultBranch,
          })
        }
        const connected = commits.length > 0
        if (!cancelled) {
          setRemoteState({
            connected,
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
  }, [activeRepo, fs, isOpen, pfs, refreshKey, repoGitDir, repoMissing, repoPath])

  useEffect(() => {
    if (!isOpen || mergeRequestsLoadedRef.current || !activeRepo || !repoPath) {
      return
    }
    if (repoMissing) {
      mergeRequestsLoadedRef.current = true
      return
    }
    const metadataPath = `${repoPath}/.edu_git_remote.json`
    const loadMergeRequests = async () => {
      try {
        const content = await pfs.readFile(metadataPath, 'utf8')
        if (!content) {
          mergeRequestsLoadedRef.current = true
          return
        }
        const data = JSON.parse(content)
        if (Array.isArray(data?.mergeRequests)) {
          setMergeRequests(data.mergeRequests)
        }
      } catch (error) {
        // ignore
      } finally {
        mergeRequestsLoadedRef.current = true
      }
    }
    loadMergeRequests()
  }, [activeRepo, isOpen, pfs, repoMissing, repoPath])

  useEffect(() => {
    if (!isOpen || !activeRepo || !repoPath) {
      return
    }
    if (repoMissing) {
      return
    }
    const metadataPath = `${repoPath}/.edu_git_remote.json`
    pfs
      .writeFile(
        metadataPath,
        JSON.stringify({ mergeRequests }, null, 2)
      )
      .catch(() => {})
  }, [activeRepo, isOpen, mergeRequests, pfs, repoMissing, repoPath])

  useEffect(() => {
    let cancelled = false
    const loadSeedMergeRequests = async () => {
      if (!isOpen || !remoteState.connected || seededMergeRequestsRef.current || !repoPath) {
        return
      }
      if (repoMissing) {
        return
      }
      const metadataPath = `${repoPath}/.edu_git_remote.json`
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
  }, [isOpen, pfs, remoteState.connected, repoMissing, repoPath])

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
    if (!cloneMenuOpen) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.remote-repo-modal__clone-menu')) {
        setCloneMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [cloneMenuOpen])

  useEffect(() => {
    if (!forkMenuOpen) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.remote-repo-modal__fork-menu')) {
        setForkMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [forkMenuOpen])

  useEffect(() => {
    if (!deleteRepoOpen) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.remote-repo-modal__delete-menu')) {
        setDeleteRepoOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [deleteRepoOpen])

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
      if (
        !isOpen ||
        !remoteState.connected ||
        !selectedBranch ||
        !repoPath ||
        !repoGitDir ||
        repoMissing
      ) {
        if (!cancelled) {
          setRemoteTree([])
          setRemoteReadme(null)
        }
        return
      }
      const gitdir = repoGitDir
      try {
        const treeEntries = await buildRemoteTree(fs, repoPath, gitdir, selectedBranch)
        if (!cancelled) {
          setRemoteTree(treeEntries)
          setExpandedFolders(new Set())
        }
        try {
          const commitOid = await git.resolveRef({
            fs,
            dir: repoPath,
            gitdir,
            ref: selectedBranch,
          })
          const { commit } = await git.readCommit({
            fs,
            dir: repoPath,
            gitdir,
            oid: commitOid,
          })
          const { tree } = await git.readTree({
            fs,
            dir: repoPath,
            gitdir,
            oid: commit.tree,
          })
          const readmeEntry = tree.find(
            (entry) => entry.type === 'blob' && entry.path === 'README.txt'
          )
          if (!readmeEntry) {
            if (!cancelled) {
              setRemoteReadme(null)
            }
          } else {
            const { blob } = await git.readBlob({
              fs,
              dir: repoPath,
              gitdir,
              oid: readmeEntry.oid,
            })
            const content = new TextDecoder().decode(blob)
            if (!cancelled) {
              setRemoteReadme(content)
            }
          }
        } catch (error) {
          if (!cancelled) {
            setRemoteReadme(null)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setRemoteTree([])
          setExpandedFolders(new Set())
          setRemoteReadme(null)
        }
      }
    }
    loadTree()
    return () => {
      cancelled = true
    }
  }, [fs, isOpen, remoteState.connected, repoGitDir, repoMissing, repoPath, selectedBranch])

  const page = useMemo(() => {
    if (route.isHome) {
      return null
    }
    return PAGES.find((entry) => entry.path === repoSubPath) || null
  }, [repoSubPath, route.isHome])
  const fileRoute = useMemo(
    () => parseFilePath(repoSubPath, remoteState.branches),
    [repoSubPath, remoteState.branches]
  )
  const mrRoute = useMemo(() => parseMrPath(repoSubPath), [repoSubPath])
  const activeMr = useMemo(
    () => mergeRequests.find((mr) => mr.slug === mrRoute) || null,
    [mergeRequests, mrRoute]
  )
  const showRepoMissing = Boolean(activeRepo && repoMissing)
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
  const isMrPairInvalid = (baseBranch, compareBranch) => {
    if (!baseBranch || !compareBranch) {
      return true
    }
    if (baseBranch === compareBranch) {
      return true
    }
    return isBranchPairTaken(mergeRequests, baseBranch, compareBranch, activeMr?.id)
  }

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
            mergeStatus: null,
            conflictFiles: [],
            mergeMessage: null,
          })
        }
        return
      }
      if (!repoPath || !repoGitDir || repoMissing) {
        if (!cancelled) {
          setMrDetail({
            commits: [],
            diffs: [],
            loading: false,
            error: 'No remote repo selected.',
            canMerge: false,
            baseOid: null,
            compareOid: null,
            mergeStatus: null,
            conflictFiles: [],
            mergeMessage: null,
            mergeRelation: null,
          })
        }
        return
      }
      const gitdir = repoGitDir
      if (activeMr.status !== 'open' && activeMr.commits && activeMr.diffs) {
        if (!cancelled) {
          setMrDetail({
            commits: activeMr.commits,
            diffs: activeMr.diffs,
            loading: false,
            error: null,
            canMerge: false,
            baseOid: activeMr.baseOid || null,
            compareOid: activeMr.compareOid || null,
            mergeStatus: activeMr.mergeStatus || activeMr.status,
            conflictFiles: activeMr.conflictFiles || [],
            mergeMessage: activeMr.mergeMessage || null,
            mergeRelation: activeMr.mergeRelation || null,
          })
        }
        return
      }
      setMrDetail((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const baseOid = await git.resolveRef({
          fs,
          dir: repoPath,
          gitdir,
          ref: activeMr.base,
        })
        const compareOid = await git.resolveRef({
          fs,
          dir: repoPath,
          gitdir,
          ref: activeMr.compare,
        })
        let mergeRelation = null
        if (baseOid && compareOid) {
          if (baseOid === compareOid) {
            mergeRelation = 'up-to-date'
          } else {
            const compareDescendsBase = await git.isDescendent({
              fs,
              dir: repoPath,
              gitdir,
              oid: compareOid,
              ancestor: baseOid,
            })
            const baseDescendsCompare = await git.isDescendent({
              fs,
              dir: repoPath,
              gitdir,
              oid: baseOid,
              ancestor: compareOid,
            })
            if (compareDescendsBase) {
              mergeRelation = 'ahead'
            } else if (baseDescendsCompare) {
              mergeRelation = 'behind'
            } else {
              mergeRelation = 'diverged'
            }
          }
        }
        if (
          activeMr.commits &&
          activeMr.diffs &&
          activeMr.mergeStatus &&
          activeMr.baseOid === baseOid &&
          activeMr.compareOid === compareOid
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
              mergeStatus: activeMr.mergeStatus,
              conflictFiles: activeMr.conflictFiles || [],
              mergeMessage: activeMr.mergeMessage || null,
              mergeRelation: activeMr.mergeRelation || mergeRelation,
            })
          }
          return
        }
        const { diffs, commits } = await computeCompareData(
          fs,
          repoPath,
          gitdir,
          activeMr.base,
          activeMr.compare
        )
        const mergeability = await getMergeability(
          fs,
          repoPath,
          gitdir,
          activeMr.base,
          activeMr.compare
        )
        const canMerge =
          activeMr.status === 'open' &&
          Boolean(compareOid && baseOid && compareOid !== baseOid) &&
          mergeability.canMerge
        if (!cancelled) {
          setMrDetail({
            diffs,
            commits,
            loading: false,
            error: null,
            canMerge,
            baseOid,
            compareOid,
            mergeStatus: mergeability.status,
            conflictFiles: mergeability.conflictFiles || [],
            mergeMessage: mergeability.message || null,
            mergeRelation,
          })
          setMergeRequests((prev) =>
            prev.map((mr) =>
              mr.id === activeMr.id
                ? {
                    ...mr,
                    diffs,
                    commits,
                    canMerge,
                    baseOid,
                    compareOid,
                    mergeStatus: mergeability.status,
                    conflictFiles: mergeability.conflictFiles || [],
                    mergeMessage: mergeability.message || null,
                    mergeRelation,
                  }
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
            mergeStatus: 'error',
            conflictFiles: [],
            mergeMessage: null,
            mergeRelation: null,
          })
        }
      }
    }
    loadMrDetail()
    return () => {
      cancelled = true
    }
  }, [activeMr, fs, isOpen, mrRoute, repoMissing])

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
      if (!repoPath || !repoGitDir || repoMissing) {
        if (!cancelled) {
          setFilePreview(null)
          setFileError('404')
        }
        return
      }
      const gitdir = repoGitDir
      try {
        const commitOid = await git.resolveRef({
          fs,
          dir: repoPath,
          gitdir,
          ref: fileRoute.branch,
        })
        const { commit } = await git.readCommit({
          fs,
          dir: repoPath,
          gitdir,
          oid: commitOid,
        })
        const parts = fileRoute.filePath.split('/')
        let currentTree = commit.tree
        for (let index = 0; index < parts.length; index += 1) {
          const part = parts[index]
          const { tree } = await git.readTree({
            fs,
            dir: repoPath,
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
              dir: repoPath,
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
  }, [fileRoute, fs, isOpen, repoGitDir, repoMissing, repoPath])

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
      if (!repoPath || !repoGitDir || repoMissing) {
        if (!cancelled) {
          setCompareDiffs([])
          setCompareCommits([])
        }
        return
      }
      const gitdir = repoGitDir
      try {
        const { diffs, commits } = await computeCompareData(
          fs,
          repoPath,
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
  }, [
    compareBase,
    compareTarget,
    fs,
    isOpen,
    remoteState.connected,
    repoGitDir,
    repoMissing,
    repoPath,
  ])

  useEffect(() => {
    let cancelled = false
    const loadCommits = async () => {
      if (
        !isOpen ||
        !remoteState.connected ||
        !selectedBranch ||
        !repoPath ||
        !repoGitDir ||
        repoMissing
      ) {
        return
      }
      const gitdir = repoGitDir
      try {
        const commits = await git.log({
          fs,
          dir: repoPath,
          gitdir,
          ref: selectedBranch,
        })
        if (!cancelled) {
          setRemoteState((prev) => ({ ...prev, commits: dedupeCommits(commits) }))
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
  }, [
    fs,
    isOpen,
    remoteState.connected,
    selectedBranch,
    commitRefreshToken,
    repoGitDir,
    repoMissing,
    repoPath,
  ])

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
            navigateRepo(route)
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
            navigateRepo(route)
          }}
        >
          <span className="remote-repo-modal__tree-icon" aria-hidden="true">
            {isFolder ? (
              isOpen ? (
                <FolderOpenIcon className="remote-repo-modal__icon remote-repo-modal__icon--open" />
              ) : (
                <FolderClosedIcon className="remote-repo-modal__icon remote-repo-modal__icon--closed" />
              )
            ) : (
              <FileIcon className="remote-repo-modal__icon remote-repo-modal__icon--file" />
            )}
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
      <div
        className="remote-repo-modal"
        role="dialog"
        aria-modal="true"
        data-cy="remote-modal"
      >
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
              const nextPath = normalizePath(address)
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
          <button
            type="button"
            className="remote-repo-modal__close"
            onClick={onClose}
            data-cy="remote-modal-close"
          >
            ×
          </button>
        </div>

        <div className="remote-repo-modal__body">
          <aside className="remote-repo-modal__sidebar">
            <div className="remote-repo-modal__repo">
              <div className="remote-repo-modal__repo-name">
                {activeRepo || 'remote.mock'}
              </div>
              <div className="remote-repo-modal__repo-meta">
                {activeRepo ? 'Remote Repo' : 'Remote Home'}
              </div>
              <div
                className={`remote-repo-modal__badge ${
                  remoteState.connected ? 'remote-repo-modal__badge--linked' : ''
                }`}
                data-cy="remote-status"
              >
                {activeRepo
                  ? repoMissing
                    ? 'Repo not found'
                    : remoteState.connected
                      ? `Linked: ${REMOTE_NAME}`
                      : 'No remote linked'
                  : 'Select a repo'}
              </div>
            </div>
            <nav className="remote-repo-modal__menu">
              <button
                type="button"
                className={`remote-repo-modal__menu-item ${
                  route.isHome ? 'is-active' : ''
                }`}
                onClick={() => onNavigate('/')}
                data-cy="remote-menu-home"
              >
                Home
              </button>
              {activeRepo && !repoMissing
                ? PAGES.filter((entry) => {
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
                        repoSubPath === entry.path ? 'is-active' : ''
                      }`}
                      onClick={() => navigateRepo(entry.path)}
                      data-cy={`remote-menu-${entry.path === '/' ? 'overview' : entry.path.slice(1)}`}
                    >
                      {entry.label}
                    </button>
                  ))
                : null}
            </nav>
          </aside>

          <main className="remote-repo-modal__content">
            {route.isHome && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2 data-cy="remote-home-title">Remote Home</h2>
                </div>
                <p>
                  Create remote repositories here and open them to explore branches,
                  commits, and merge requests.
                </p>
                <div className="remote-repo-modal__card remote-repo-modal__home-card">
                  <div className="remote-repo-modal__row">
                    <h3>Repositories</h3>
                    <button
                      type="button"
                      className="remote-repo-modal__primary"
                      onClick={() => {
                        setCreateRepoOpen((prev) => !prev)
                        setCreateRepoError('')
                      }}
                      data-cy="remote-home-create-toggle"
                    >
                      New Repo
                    </button>
                  </div>
                  {remoteRepos.length === 0 ? (
                    <div className="remote-repo-modal__empty">
                      No remote repositories yet.
                    </div>
                  ) : (
                    <div className="remote-repo-modal__repo-list">
                      {remoteRepos.map((repo) => (
                        <button
                          key={repo}
                          type="button"
                          className="remote-repo-modal__repo-item"
                          onClick={() => onNavigate(`/${repo}`)}
                          data-cy="remote-home-repo"
                          data-repo={repo}
                        >
                          {repo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {createRepoOpen ? (
                  <div className="remote-repo-modal__card remote-repo-modal__home-create">
                    <h3>Create a new repository</h3>
                    <label className="remote-repo-modal__mr-field">
                      <span>Repository name</span>
                      <input
                        type="text"
                        value={createRepoName}
                        onChange={(event) => {
                          setCreateRepoName(event.target.value)
                          setCreateRepoError('')
                        }}
                        placeholder="my-project"
                        data-cy="remote-home-create-input"
                      />
                    </label>
                    {createRepoError ? (
                      <div className="remote-repo-modal__home-error">{createRepoError}</div>
                    ) : null}
                    <div className="remote-repo-modal__home-actions">
                      <button
                        type="button"
                        className="remote-repo-modal__mr-confirm-cancel"
                        onClick={() => {
                          setCreateRepoOpen(false)
                          setCreateRepoName('')
                          setCreateRepoError('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="remote-repo-modal__mr-create"
                        disabled={!createRepoName.trim()}
                        onClick={async () => {
                          const rawName = createRepoName.trim()
                          if (!rawName) {
                            return
                          }
                          if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rawName)) {
                            setCreateRepoError(
                              'Use letters, numbers, dots, dashes, or underscores.'
                            )
                            return
                          }
                          const repoPath = `${REMOTE_ROOT}/${rawName}`
                          try {
                            await pfs.stat(repoPath)
                            setCreateRepoError('A repo with this name already exists.')
                            return
                          } catch (error) {
                            // Not found means we can create it.
                          }
                          try {
                            await pfs.mkdir(REMOTE_ROOT).catch((error) => {
                              if (error?.code !== 'EEXIST') {
                                throw error
                              }
                            })
                            await pfs.mkdir(repoPath)
                            await git.init({
                              fs,
                              dir: repoPath,
                              gitdir: `${repoPath}/.git`,
                              defaultBranch: 'main',
                            })
                            setRemoteRepos((prev) =>
                              [...prev, rawName]
                                .filter((value, index, arr) => arr.indexOf(value) === index)
                                .sort()
                            )
                            setCreateRepoOpen(false)
                            setCreateRepoName('')
                            setCreateRepoError('')
                            onNavigate(`/${rawName}`)
                          } catch (error) {
                            setCreateRepoError('Unable to create repo. Try again.')
                          }
                        }}
                        data-cy="remote-home-create-submit"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {showRepoMissing && !fileRoute ? (
              <div className="remote-repo-modal__notfound">
                <div className="remote-repo-modal__notfound-code">404</div>
                <div className="remote-repo-modal__notfound-title">Repository not found</div>
                <div className="remote-repo-modal__notfound-text">
                  Create this repo from Remote Home to continue.
                </div>
              </div>
            ) : null}
            {!showRepoMissing && page?.path === '/' && !fileRoute && (
              <>
                <div className="remote-repo-modal__header">
                  <h2 data-cy="remote-overview-title">Remote Overview</h2>
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
                    : `This remote repo is not connected yet. Link your local repo to ${remoteUrl} to sync changes.`}
                </p>
                {remoteState.connected ? (
                  <div className="remote-repo-modal__card">
                    <div className="remote-repo-modal__row">
                      <h3>Repository tree</h3>
                      <div className="remote-repo-modal__actions">
                        <div className="remote-repo-modal__clone">
                          <button
                            type="button"
                            className="remote-repo-modal__action-button"
                            onClick={() => setCloneMenuOpen((prev) => !prev)}
                            data-cy="remote-clone-toggle"
                          >
                            <span className="remote-repo-modal__action-icon" aria-hidden="true">
                              {cloneIcon}
                            </span>
                            Clone
                          </button>
                          {cloneMenuOpen ? (
                            <div className="remote-repo-modal__clone-menu">
                              <div className="remote-repo-modal__clone-title">
                                Clone this repo
                              </div>
                              <pre>git clone {remoteUrl}</pre>
                            </div>
                          ) : null}
                        </div>
                        <div className="remote-repo-modal__fork">
                          <button
                            type="button"
                            className="remote-repo-modal__action-button remote-repo-modal__action-button--fork"
                            onClick={() => {
                              setForkMenuOpen((prev) => !prev)
                              setForkError('')
                            }}
                            data-cy="remote-fork-toggle"
                          >
                            <span className="remote-repo-modal__action-icon" aria-hidden="true">
                              {forkIcon}
                            </span>
                            Fork
                          </button>
                          {forkMenuOpen ? (
                            <div className="remote-repo-modal__fork-menu">
                              <div className="remote-repo-modal__clone-title">
                                Fork this repo
                              </div>
                              <label className="remote-repo-modal__mr-field">
                                <span>New repo name</span>
                                <input
                                  type="text"
                                  value={forkName}
                                  onChange={(event) => {
                                    setForkName(event.target.value)
                                    setForkError('')
                                  }}
                                  placeholder={`${activeRepo}-fork`}
                                  data-cy="remote-fork-input"
                                />
                              </label>
                              {forkError ? (
                                <div className="remote-repo-modal__home-error">{forkError}</div>
                              ) : null}
                              <div className="remote-repo-modal__home-actions">
                                <button
                                  type="button"
                                  className="remote-repo-modal__mr-confirm-cancel"
                                  onClick={() => {
                                    setForkMenuOpen(false)
                                    setForkName('')
                                    setForkError('')
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="remote-repo-modal__mr-create"
                                  disabled={!forkName.trim()}
                                  onClick={async () => {
                                    const rawName = forkName.trim()
                                    if (!rawName) {
                                      return
                                    }
                                    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rawName)) {
                                      setForkError(
                                        'Use letters, numbers, dots, dashes, or underscores.'
                                      )
                                      return
                                    }
                                    const forkPath = `${REMOTE_ROOT}/${rawName}`
                                    try {
                                      await pfs.stat(forkPath)
                                      setForkError('A repo with this name already exists.')
                                      return
                                    } catch (error) {
                                      // Not found means we can create it.
                                    }
                                    try {
                                      await copyDir(pfs, repoPath, forkPath)
                                      setRemoteRepos((prev) =>
                                        [...prev, rawName]
                                          .filter((value, index, arr) => arr.indexOf(value) === index)
                                          .sort()
                                      )
                                      setForkMenuOpen(false)
                                      setForkName('')
                                      setForkError('')
                                      onNavigate(`/${rawName}`)
                                    } catch (error) {
                                      setForkError('Unable to fork repo. Try again.')
                                    }
                                  }}
                                  data-cy="remote-fork-submit"
                                >
                                  Create fork
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="remote-repo-modal__delete">
                          <button
                            type="button"
                            className="remote-repo-modal__action-button remote-repo-modal__action-button--danger"
                            onClick={() => setDeleteRepoOpen((prev) => !prev)}
                            data-cy="remote-delete-toggle"
                          >
                            <span className="remote-repo-modal__action-icon" aria-hidden="true">
                              {deleteIcon}
                            </span>
                            Delete
                          </button>
                          {deleteRepoOpen ? (
                            <div className="remote-repo-modal__delete-menu">
                              <div className="remote-repo-modal__clone-title">
                                Delete this repo?
                              </div>
                              <p className="remote-repo-modal__delete-text">
                                This removes the remote repo and all of its data.
                              </p>
                              <div className="remote-repo-modal__home-actions">
                                <button
                                  type="button"
                                  className="remote-repo-modal__mr-confirm-cancel"
                                  onClick={() => setDeleteRepoOpen(false)}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="remote-repo-modal__delete-confirm"
                                  onClick={async () => {
                                    try {
                                      await pfs.rm(repoPath, { recursive: true })
                                    } catch (error) {
                                      // Ignore delete errors to keep flow smooth.
                                    }
                                    setRemoteRepos((prev) =>
                                      prev.filter((repo) => repo !== activeRepo)
                                    )
                                    setDeleteRepoOpen(false)
                                    onNavigate('/')
                                  }}
                                  data-cy="remote-delete-confirm"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
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
                {remoteState.connected && remoteReadme ? (
                  <div className="remote-repo-modal__card">
                    <h3>README</h3>
                    <pre className="remote-repo-modal__readme">{remoteReadme}</pre>
                  </div>
                ) : null}
                {!remoteState.connected ? (
                  <>
                    <div className="remote-repo-modal__card" data-cy="remote-init-card">
                      <h3>Initialize your repo</h3>
                      <pre>git init</pre>
                      <pre>git add .</pre>
                      <pre>git commit -m &quot;init&quot;</pre>
                    </div>
                    <div className="remote-repo-modal__card" data-cy="remote-connect-card">
                      <h3>Connect to remote</h3>
                      <pre>git remote add origin {remoteUrl}</pre>
                      <pre>git push -u origin main</pre>
                    </div>
                  </>
                ) : null}
              </>
            )}
            {!showRepoMissing &&
            activeRepo &&
            !remoteState.connected &&
            repoSubPath !== '/' &&
            !fileRoute ? (
              <div className="remote-repo-modal__empty">
                Connect this repo first to view branches, commits, and merge requests.
              </div>
            ) : null}
            {!showRepoMissing &&
              remoteState.connected &&
              page?.path === '/branches' &&
              !fileRoute && (
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
            {!showRepoMissing &&
              remoteState.connected &&
              page?.path === '/commits' &&
              !fileRoute && (
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
            {!showRepoMissing &&
              remoteState.connected &&
              page?.path === '/compare' &&
              !fileRoute && (
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
                              navigateRepo(`/mr/${slug}`)
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
            {!showRepoMissing &&
              remoteState.connected &&
              page?.path === '/merge-requests' &&
              !fileRoute &&
              !mrRoute && (
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
                          onClick={() => navigateRepo(`/mr/${mr.slug}`)}
                          data-cy="remote-mr-row"
                          data-slug={mr.slug}
                        >
                          <span>{mr.title}</span>
                          <span>
                            {mr.compare} → {mr.base}
                          </span>
                          <span className="remote-repo-modal__mr-status">
                            {mr.status}
                            {mr.mergeStatus === 'conflict' ? (
                              <span className="remote-repo-modal__mr-chip remote-repo-modal__mr-chip--conflict remote-repo-modal__mr-chip--inline">
                                Conflict
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
            {mrRoute && activeMr && !fileRoute && !showRepoMissing && remoteState.connected && (
              <>
                <div className="remote-repo-modal__header">
                  <div className="remote-repo-modal__mr-title">
                    <h2>{activeMr.title}</h2>
                    {activeMr.status === 'merged' ? (
                      <span className="remote-repo-modal__mr-chip">Merged</span>
                    ) : null}
                    {mrDetail.mergeStatus === 'conflict' ? (
                      <span className="remote-repo-modal__mr-chip remote-repo-modal__mr-chip--conflict">
                        Conflict
                      </span>
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
                          if (!repoPath || !repoGitDir) {
                            setMrAction(null)
                            setDeleteBranchOnMerge(false)
                            return
                          }
                          const gitdir = repoGitDir
                          try {
                            await git.merge({
                              fs,
                              dir: repoPath,
                              gitdir,
                              ours: activeMr.base,
                              theirs: activeMr.compare,
                              fastForward: true,
                              fastForwardOnly: false,
                              abortOnConflict: true,
                              author: MERGE_AUTHOR,
                              committer: MERGE_AUTHOR,
                            })
                          } catch (error) {
                            const conflict =
                              error?.code === 'MergeConflictError' ||
                              error?.code === 'MergeNotSupportedError'
                            setMrDetail((prev) => ({
                              ...prev,
                              canMerge: false,
                              mergeStatus: conflict ? 'conflict' : 'error',
                              conflictFiles: conflict ? error?.data?.filepaths || [] : [],
                              mergeMessage: conflict
                                ? 'Merge blocked by conflicts.'
                                : error?.message || 'Unable to merge.',
                            }))
                            setMrAction(null)
                            setDeleteBranchOnMerge(false)
                            return
                          }
                          if (
                            deleteBranchOnMerge &&
                            activeMr.compare &&
                            activeMr.compare !== activeMr.base
                          ) {
                            try {
                              await git.deleteRef({
                                fs,
                                dir: repoPath,
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
                                    mergeStatus: 'merged',
                                    conflictFiles: [],
                                    mergeMessage: null,
                                  }
                                : mr
                            )
                          )
                          if (selectedBranch === activeMr.base) {
                            setCommitRefreshToken((prev) => prev + 1)
                          }
                        } else {
                          setMergeRequests((prev) =>
                            prev.map((mr) =>
                              mr.id === activeMr.id
                                ? {
                                    ...mr,
                                    status: 'closed',
                                    commits: mrDetail.commits,
                                    diffs: mrDetail.diffs,
                                    mergeStatus: 'closed',
                                    conflictFiles: [],
                                    mergeMessage: null,
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
                  <div className="remote-repo-modal__mr-summary-row">
                    <label>
                      <span>Base</span>
                      <select
                        className="remote-repo-modal__mr-summary-select"
                        value={activeMr.base}
                        disabled={activeMr.status !== 'open'}
                        data-cy="mr-base-select"
                        onChange={(event) => {
                          const nextBase = event.target.value
                          if (isMrPairInvalid(nextBase, activeMr.compare)) {
                            return
                          }
                          setMergeRequests((prev) =>
                            prev.map((mr) =>
                              mr.id === activeMr.id
                                ? {
                                    ...mr,
                                    base: nextBase,
                                    commits: [],
                                    diffs: [],
                                    canMerge: false,
                                    baseOid: null,
                                    compareOid: null,
                                    mergeStatus: null,
                                    conflictFiles: [],
                                    mergeMessage: null,
                                    mergeRelation: null,
                                  }
                                : mr
                            )
                          )
                        }}
                      >
                        {remoteState.branches.map((branch) => (
                          <option
                            key={`mr-base-${branch}`}
                            value={branch}
                            disabled={isMrPairInvalid(branch, activeMr.compare)}
                          >
                            {branch}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="remote-repo-modal__mr-summary-arrow">←</span>
                    <label>
                      <span>Compare</span>
                      <select
                        className="remote-repo-modal__mr-summary-select"
                        value={activeMr.compare}
                        disabled={activeMr.status !== 'open'}
                        data-cy="mr-compare-select"
                        onChange={(event) => {
                          const nextCompare = event.target.value
                          if (isMrPairInvalid(activeMr.base, nextCompare)) {
                            return
                          }
                          setMergeRequests((prev) =>
                            prev.map((mr) =>
                              mr.id === activeMr.id
                                ? {
                                    ...mr,
                                    compare: nextCompare,
                                    commits: [],
                                    diffs: [],
                                    canMerge: false,
                                    baseOid: null,
                                    compareOid: null,
                                    mergeStatus: null,
                                    conflictFiles: [],
                                    mergeMessage: null,
                                    mergeRelation: null,
                                  }
                                : mr
                            )
                          )
                        }}
                      >
                        {remoteState.branches.map((branch) => (
                          <option
                            key={`mr-compare-${branch}`}
                            value={branch}
                            disabled={isMrPairInvalid(activeMr.base, branch)}
                          >
                            {branch}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                {mrDetail.mergeRelation && mrDetail.mergeStatus !== 'conflict' ? (
                  <div className="remote-repo-modal__mr-meta">
                    {mrDetail.mergeRelation === 'ahead'
                      ? 'Branch is ahead of base.'
                      : mrDetail.mergeRelation === 'behind'
                        ? 'Branch is behind base.'
                        : mrDetail.mergeRelation === 'up-to-date'
                          ? 'Branch is up to date with base.'
                          : 'Branch has diverged from base.'}
                  </div>
                ) : null}
                {mrDetail.mergeStatus === 'conflict' ? (
                  <div className="remote-repo-modal__mr-warning">
                    <div className="remote-repo-modal__mr-warning-title">
                      Merge blocked by conflicts.
                      {mrDetail.conflictFiles?.length
                        ? ` Files: ${mrDetail.conflictFiles.join(', ')}`
                        : ''}
                    </div>
                    <div className="remote-repo-modal__mr-help-row">
                      <div className="remote-repo-modal__mr-help-title">
                        Resolve locally, then push the fix
                      </div>
                      <label className="remote-repo-modal__mr-help-select">
                        <span>Strategy</span>
                        <select
                          value={conflictStrategy}
                          onChange={(event) => setConflictStrategy(event.target.value)}
                        >
                          {CONFLICT_STRATEGIES.map((strategy) => (
                            <option key={strategy.id} value={strategy.id}>
                              {strategy.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="remote-repo-modal__mr-help-text">
                      {buildConflictExplanation(
                        conflictStrategy,
                        activeMr.base,
                        activeMr.compare
                      )}
                    </p>
                    <pre>
                      {buildConflictCommands(
                        conflictStrategy,
                        activeMr.base,
                        activeMr.compare
                      ).join('\n')}
                    </pre>
                    {conflictStrategy === 'cherry-pick' ? (
                      <p className="remote-repo-modal__mr-help-note">
                        After pushing, update the branches above to{' '}
                        {`${activeMr.base} ← ${activeMr.compare}_resolved`}.
                      </p>
                    ) : null}
                  </div>
                ) : mrDetail.mergeStatus === 'already-merged' ? (
                  <div className="remote-repo-modal__mr-warning">
                    This branch is already merged into {activeMr.base}.
                  </div>
                ) : mrDetail.mergeMessage ? (
                  <div className="remote-repo-modal__mr-warning">{mrDetail.mergeMessage}</div>
                ) : null}
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
            {mrRoute && !activeMr && !fileRoute && !showRepoMissing && remoteState.connected && (
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
                          navigateRepo(nextRoute)
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
            {!page && !fileRoute && !mrRoute && !route.isHome && !showRepoMissing && (
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
