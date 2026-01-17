import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import LightningFS from '@isomorphic-git/lightning-fs'
import readmeContent from '../content/README.txt?raw'
import gitCheatSheetContent from '../content/GIT_CHEAT_SHEET.txt?raw'
import gitInfoContent from '../content/GIT_INFO.txt?raw'
import remoteDemoReadmeContent from '../content/REMOTE_DEMO_README.txt?raw'
import remoteDemoInfoContent from '../content/REMOTE_DEMO_INFO.txt?raw'
import mockReadmeContent from '../content/MOCK_README.txt?raw'
import mockDocsOverviewContent from '../content/MOCK_DOCS_OVERVIEW.txt?raw'
import mockDocsSetupContent from '../content/MOCK_DOCS_SETUP.txt?raw'
import mockSrcIndexContent from '../content/MOCK_SRC_INDEX.txt?raw'
import mockComponentAppContent from '../content/MOCK_COMPONENT_APP.txt?raw'
import mockComponentSidebarContent from '../content/MOCK_COMPONENT_SIDEBAR.txt?raw'
import mockUtilsHelpersContent from '../content/MOCK_UTILS_HELPERS.txt?raw'
import mockNotesIdeasContent from '../content/MOCK_NOTES_IDEAS.txt?raw'
import { seedMockConflictEnvironment } from './mockConflictEnvironment'

const FileSystemContext = createContext(null)

const normalizeFileName = (name) => {
  const trimmed = name.trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed === 'gitignore' || trimmed === '.gitignore') {
    return '.gitignore'
  }
  if (trimmed.startsWith('.')) {
    return trimmed
  }
  let base = trimmed
  if (base.toLowerCase().endsWith('.txt')) {
    base = base.slice(0, -4)
  } else if (base.includes('.')) {
    base = base.slice(0, base.lastIndexOf('.'))
  }
  return `${base}.txt`
}

const joinPath = (parent, name) => {
  if (!parent || parent === '/') {
    return `/${name}`
  }
  return `${parent}/${name}`
}

const encodeBytes = (bytes) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

const decodeBytes = (encoded) => {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const exportFileSystem = async (pfs, rootPath = '/') => {
  const entries = []
  const walk = async (dirPath) => {
    const names = await pfs.readdir(dirPath)
    for (const name of names) {
      const path = joinPath(dirPath, name)
      const stats = await pfs.stat(path)
      if (stats.type === 'dir') {
        entries.push({ path, type: 'dir' })
        await walk(path)
      } else {
        const content = await pfs.readFile(path)
        entries.push({ path, type: 'file', data: encodeBytes(content) })
      }
    }
  }
  await walk(rootPath)
  return entries
}

const createSnapshotString = ({ entries, ui, mergeRequests }) =>
  JSON.stringify({
    version: 1,
    createdAt: Date.now(),
    entries,
    ui,
    mergeRequests: mergeRequests || [],
  })

const createSnapshotFromSeed = async (pfs, seedFn, ui) => {
  await clearRoot(pfs)
  await seedFn()
  const entries = await exportFileSystem(pfs, '/')
  return createSnapshotString({
    entries,
    ui,
    mergeRequests: typeof window !== 'undefined' ? window.__eduGitMergeRequests || [] : [],
  })
}

const importFileSystem = async (pfs, entries) => {
  const dirs = entries.filter((entry) => entry.type === 'dir')
  const files = entries.filter((entry) => entry.type === 'file')
  dirs.sort((a, b) => a.path.length - b.path.length)
  for (const dir of dirs) {
    await ensureDir(pfs, dir.path)
  }
  for (const file of files) {
    await pfs.writeFile(file.path, decodeBytes(file.data))
  }
}

const sortNodes = (nodes) =>
  nodes.slice().sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

const buildTree = async (pfs, dirPath = '/') => {
  const entries = await pfs.readdir(dirPath)
  const nodes = await Promise.all(
    entries
      .filter((entry) => entry !== '.git' && entry !== '.remotes')
      .map(async (entry) => {
      const path = joinPath(dirPath, entry)
      const stats = await pfs.stat(path)
      if (stats.type === 'dir') {
        return {
          id: path,
          path,
          name: entry,
          type: 'folder',
          children: await buildTree(pfs, path),
        }
      }
      return {
        id: path,
        path,
        name: entry,
        type: 'file',
      }
    })
  )
  return sortNodes(nodes)
}

const findNodeByPath = (nodes, targetPath) => {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }
    if (node.type === 'folder') {
      const found = findNodeByPath(node.children, targetPath)
      if (found) {
        return found
      }
    }
  }
  return null
}

const ensureDir = async (pfs, path) => {
  try {
    await pfs.mkdir(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }
}

const ensureFile = async (pfs, path, content) => {
  try {
    await pfs.stat(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    await pfs.writeFile(path, content)
  }
}

const clearRoot = async (pfs) => {
  const entries = await pfs.readdir('/')
  for (const entry of entries) {
    await removePath(pfs, joinPath('/', entry))
  }
}


const removePath = async (pfs, targetPath) => {
  let stats
  try {
    stats = await pfs.stat(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }
    throw error
  }
  if (stats.type === 'dir') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const entries = await pfs.readdir(targetPath)
      for (const entry of entries) {
        await removePath(pfs, joinPath(targetPath, entry))
      }
      try {
        await pfs.rmdir(targetPath)
        return
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return
        }
        if (error?.code !== 'ENOTEMPTY') {
          throw error
        }
      }
    }
    return
  }
  try {
    await pfs.unlink(targetPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

function FileSystemProvider({ children }) {
  const fsRef = useRef(null)
  if (!fsRef.current) {
    fsRef.current = new LightningFS('edu-git')
  }
  const pfs = fsRef.current.promises
  const [tree, setTree] = useState([])
  const [selectedFilePath, setSelectedFilePath] = useState('/src/README.txt')
  const [selectedFile, setSelectedFile] = useState(null)
  const [openFilePaths, setOpenFilePaths] = useState(['/src/README.txt'])
  const [isReady, setIsReady] = useState(false)
  const [resetToken, setResetToken] = useState(0)

  const refreshTree = useCallback(async () => {
    const nextTree = await buildTree(pfs, '/')
    setTree(nextTree)
  }, [
    gitCheatSheetContent,
    gitInfoContent,
    pfs,
    readmeContent,
    remoteDemoInfoContent,
    remoteDemoReadmeContent,
  ])

  const statPath = useCallback(
    async (path) => {
      try {
        return await pfs.stat(path)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return null
        }
        throw error
      }
    },
    [pfs]
  )

  const readDirectory = useCallback(
    async (path) => {
      const stats = await statPath(path)
      if (!stats || stats.type !== 'dir') {
        return null
      }
      return pfs.readdir(path)
    },
    [pfs, statPath]
  )

  const readTextFile = useCallback(
    async (path) => {
      const stats = await statPath(path)
      if (!stats || stats.type !== 'file') {
        return null
      }
      return pfs.readFile(path, { encoding: 'utf8' })
    },
    [pfs, statPath]
  )

  const seedDemoRemote = useCallback(async () => {
    const demoPath = '/.remotes/edu-git'
    const demoGitdir = `${demoPath}/.git`
    await ensureDir(pfs, '/.remotes')
    await ensureDir(pfs, demoPath)
    await ensureFile(pfs, `${demoPath}/README.txt`, remoteDemoReadmeContent)
    await ensureFile(pfs, `${demoPath}/INFO.txt`, remoteDemoInfoContent)
    let hasCommits = false
    try {
      const commits = await git.log({
        fs: fsRef.current,
        dir: demoPath,
        gitdir: demoGitdir,
      })
      hasCommits = commits.length > 0
    } catch (error) {
      hasCommits = false
    }
    if (hasCommits) {
      return
    }
    try {
      await git.init({
        fs: fsRef.current,
        dir: demoPath,
        gitdir: demoGitdir,
        defaultBranch: 'main',
      })
    } catch (error) {
      // Ignore init errors if repo already exists.
    }
    await git.add({
      fs: fsRef.current,
      dir: demoPath,
      gitdir: demoGitdir,
      filepath: 'README.txt',
    })
    await git.add({
      fs: fsRef.current,
      dir: demoPath,
      gitdir: demoGitdir,
      filepath: 'INFO.txt',
    })
    await git.commit({
      fs: fsRef.current,
      dir: demoPath,
      gitdir: demoGitdir,
      author: { name: 'Edu Git', email: 'edu@example.com' },
      message: 'Initial remote repo setup',
    })
  }, [pfs, remoteDemoInfoContent, remoteDemoReadmeContent])

  const seedDefault = useCallback(async () => {
    await ensureDir(pfs, '/src')
    await ensureFile(pfs, '/src/README.txt', readmeContent)
    await ensureFile(pfs, '/GIT_CHEAT_SHEET.txt', gitCheatSheetContent)
    await ensureFile(pfs, '/GIT_INFO.txt', gitInfoContent)
    await seedDemoRemote()
  }, [gitCheatSheetContent, gitInfoContent, pfs, readmeContent, seedDemoRemote])

  const loadEnvironment = useCallback(
    async (snapshotString) => {
      if (!snapshotString) {
        return false
      }
      try {
        const snapshot = JSON.parse(snapshotString)
        await clearRoot(pfs)
        await importFileSystem(pfs, snapshot.entries || [])
        await refreshTree()
        if (snapshot.ui?.selectedFilePath) {
          setSelectedFilePath(snapshot.ui.selectedFilePath)
        } else {
          setSelectedFilePath(null)
        }
        if (snapshot.ui?.openFilePaths?.length) {
          setOpenFilePaths(snapshot.ui.openFilePaths)
        } else {
          setOpenFilePaths([])
        }
        if (typeof window !== 'undefined') {
          window.__eduGitMergeRequests = snapshot.mergeRequests || []
        }
        setResetToken((prev) => prev + 1)
        return true
      } catch (error) {
        return false
      }
    },
    [pfs, refreshTree]
  )

  useEffect(() => {
    const bootstrap = async () => {
      const snapshotString = await createSnapshotFromSeed(pfs, seedDefault, {
        selectedFilePath: '/src/README.txt',
        openFilePaths: ['/src/README.txt'],
      })
      await loadEnvironment(snapshotString)
      setIsReady(true)
    }
    bootstrap()
  }, [loadEnvironment, pfs, seedDefault])

  useEffect(() => {
    const loadSelected = async () => {
      if (!selectedFilePath) {
        setSelectedFile(null)
        return
      }
      try {
        const content = await pfs.readFile(selectedFilePath, { encoding: 'utf8' })
        const node = findNodeByPath(tree, selectedFilePath)
        setSelectedFile({
          id: selectedFilePath,
          path: selectedFilePath,
          name: node?.name || selectedFilePath.split('/').pop(),
          type: 'file',
          content,
        })
      } catch (error) {
        setSelectedFile(null)
      }
    }
    loadSelected()
  }, [pfs, selectedFilePath, tree])

  const openFiles = useMemo(
    () =>
      openFilePaths
        .map((path) => {
          const node = findNodeByPath(tree, path)
          if (!node) {
            return null
          }
          return { ...node, id: node.path }
        })
        .filter(Boolean),
    [tree, openFilePaths]
  )

  const selectFile = (path) => {
    if (!path) {
      return
    }
    setSelectedFilePath(path)
  }

  const openFile = async (path) => {
    if (!path) {
      return
    }
    const node = findNodeByPath(tree, path)
    if (!node || node.type !== 'file') {
      return
    }
    setOpenFilePaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setSelectedFilePath(path)
  }

  const closeFile = (path) => {
    setOpenFilePaths((prev) => {
      const remaining = prev.filter((filePath) => filePath !== path)
      setSelectedFilePath((prevSelected) => {
        if (prevSelected !== path) {
          return prevSelected
        }
        return remaining[remaining.length - 1] || null
      })
      return remaining
    })
  }

  const updateFileContent = async (path, content) => {
    await pfs.writeFile(path, content)
    setSelectedFile((prev) => (prev ? { ...prev, content } : prev))
  }

  const createFile = async ({ parentId, name, content = '', autoOpen = false }) => {
    const fileName = normalizeFileName(name)
    if (!fileName) {
      return null
    }
    const parentPath = parentId || '/'
    const filePath = joinPath(parentPath, fileName)
    try {
      await pfs.stat(filePath)
      return null
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return null
      }
    }
    await pfs.writeFile(filePath, content)
    await refreshTree()
    if (autoOpen) {
      setOpenFilePaths((prev) =>
        prev.includes(filePath) ? prev : [...prev, filePath]
      )
      setSelectedFilePath(filePath)
    }
    return { id: filePath }
  }

  const createFolder = async ({ parentId, name }) => {
    const parentPath = parentId || '/'
    const folderPath = joinPath(parentPath, name.trim())
    if (!name.trim()) {
      return false
    }
    try {
      await pfs.stat(folderPath)
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return false
      }
    }
    await ensureDir(pfs, folderPath)
    await refreshTree()
    return true
  }

  const deleteNode = async (path) => {
    const target = findNodeByPath(tree, path)
    if (!target) {
      return
    }
    await removePath(pfs, path)
    await refreshTree()
    setOpenFilePaths((prev) => prev.filter((filePath) => filePath !== path))
    setSelectedFilePath((prevSelected) => (prevSelected === path ? null : prevSelected))
  }

  const renameNode = async (path, name) => {
    const target = findNodeByPath(tree, path)
    if (!target) {
      return false
    }
    const parentPath = path.split('/').slice(0, -1).join('/') || '/'
    const nextName =
      target.type === 'file' ? normalizeFileName(name) : name.trim()
    if (!nextName) {
      return false
    }
    const nextPath = joinPath(parentPath, nextName)
    try {
      await pfs.stat(nextPath)
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return false
      }
    }
    await pfs.rename(path, nextPath)
    await refreshTree()
    setOpenFilePaths((prev) =>
      prev.map((filePath) => (filePath === path ? nextPath : filePath))
    )
    setSelectedFilePath((prevSelected) =>
      prevSelected === path ? nextPath : prevSelected
    )
    return true
  }

  const resetInstance = async () => {
    const snapshotString = await createSnapshotFromSeed(pfs, seedDefault, {
      selectedFilePath: '/src/README.txt',
      openFilePaths: ['/src/README.txt'],
    })
    await loadEnvironment(snapshotString)
  }

  const seedMockEnvironment = async () => {
    await ensureDir(pfs, '/docs')
    await ensureDir(pfs, '/src')
    await ensureDir(pfs, '/src/components')
    await ensureDir(pfs, '/src/utils')
    await ensureDir(pfs, '/notes')
    await ensureFile(pfs, '/README.txt', mockReadmeContent)
    await ensureFile(pfs, '/docs/overview.txt', mockDocsOverviewContent)
    await ensureFile(pfs, '/docs/setup.txt', mockDocsSetupContent)
    await ensureFile(pfs, '/src/index.txt', mockSrcIndexContent)
    await ensureFile(pfs, '/src/components/App.txt', mockComponentAppContent)
    await ensureFile(pfs, '/src/components/Sidebar.txt', mockComponentSidebarContent)
    await ensureFile(pfs, '/src/utils/helpers.txt', mockUtilsHelpersContent)
    await ensureFile(pfs, '/notes/ideas.txt', mockNotesIdeasContent)
    await ensureFile(pfs, '/GIT_CHEAT_SHEET.txt', gitCheatSheetContent)
    await ensureFile(pfs, '/GIT_INFO.txt', gitInfoContent)
    await seedDemoRemote()
    const gitdir = '/.git'
    await git.init({ fs: fsRef.current, dir: '/', gitdir, defaultBranch: 'main' })
    const statusMatrix = await git.statusMatrix({ fs: fsRef.current, dir: '/', gitdir })
    for (const [filepath] of statusMatrix) {
      if (filepath.startsWith('.git')) {
        continue
      }
      await git.add({ fs: fsRef.current, dir: '/', gitdir, filepath })
    }
    await git.commit({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      author: { name: 'Edu Git', email: 'edu@example.com' },
      message: 'init commit',
    })
    await git.setConfig({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      path: 'remote.origin.url',
      value: 'https://remote.mock/trail-tracker',
    })
    await git.setConfig({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      path: 'remote.origin.fetch',
      value: '+refs/heads/*:refs/remotes/origin/*',
    })
    const ensureRemoteDir = async (path) => {
      try {
        await pfs.mkdir(path)
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          throw error
        }
      }
    }
    const copyDir = async (source, destination) => {
      try {
        await ensureRemoteDir(destination)
        const entries = await pfs.readdir(source)
        for (const entry of entries) {
          const fromPath = `${source}/${entry}`
          const toPath = `${destination}/${entry}`
          const stats = await pfs.stat(fromPath)
          if (stats.type === 'dir') {
            await copyDir(fromPath, toPath)
          } else {
            const content = await pfs.readFile(fromPath)
            await pfs.writeFile(toPath, content)
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error
        }
      }
    }
    const copyWorkingTree = async (source, destination) => {
      const entries = await pfs.readdir(source)
      for (const entry of entries) {
        if (entry === '.git' || entry === '.remotes') {
          continue
        }
        const fromPath = joinPath(source, entry)
        const toPath = joinPath(destination, entry)
        const stats = await pfs.stat(fromPath)
        if (stats.type === 'dir') {
          await ensureRemoteDir(toPath)
          await copyWorkingTree(fromPath, toPath)
        } else {
          const content = await pfs.readFile(fromPath)
          await pfs.writeFile(toPath, content)
        }
      }
    }
    await ensureRemoteDir('/.remotes')
    await ensureRemoteDir('/.remotes/trail-tracker')
    const remotePath = '/.remotes/trail-tracker'
    const remoteGitdir = '/.remotes/trail-tracker/.git'
    try {
      await pfs.stat(remoteGitdir)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      await git.init({ fs: fsRef.current, dir: remotePath, gitdir: remoteGitdir, defaultBranch: 'main' })
    }
    await copyDir(gitdir, remoteGitdir)
    await copyWorkingTree('/', remotePath)
    const localOid = await git.resolveRef({ fs: fsRef.current, dir: '/', gitdir, ref: 'main' })
    await git.writeRef({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      ref: 'refs/heads/main',
      value: localOid,
      force: true,
    })
    await git.branch({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      ref: 'test_branch',
    })
    await git.checkout({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      ref: 'test_branch',
    })
    const readmePath = '/README.txt'
    const readmeText = await pfs.readFile(readmePath, 'utf8')
    const testReadme = `${readmeText.trimEnd()}\n\nTest branch notes:\n- Update README.txt with a branch-specific change.\n`
    await pfs.writeFile(readmePath, testReadme)
    await git.add({ fs: fsRef.current, dir: '/', gitdir, filepath: 'README.txt' })
    await git.commit({
      fs: fsRef.current,
      dir: '/',
      gitdir,
      author: { name: 'Learner', email: 'learner@example.com' },
      message: 'Update README in test_branch',
    })
    await git.branch({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      ref: 'collaborator_branch',
    })
    await git.checkout({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      ref: 'collaborator_branch',
    })
    const remoteDocsPath = `${remotePath}/docs/overview.txt`
    const remoteHelpersPath = `${remotePath}/src/utils/helpers.txt`
    const remoteDocsText = await pfs.readFile(remoteDocsPath, 'utf8')
    const remoteHelpersText = await pfs.readFile(remoteHelpersPath, 'utf8')
    await pfs.writeFile(
      remoteDocsPath,
      `${remoteDocsText.trimEnd()}\n\nCollaborator update: clarify the setup flow.\n`
    )
    await pfs.writeFile(
      remoteHelpersPath,
      `${remoteHelpersText.trimEnd()}\n\naddTestHelpers(name):\n  return "helper:" + name\n`
    )
    await git.add({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      filepath: 'docs/overview.txt',
    })
    await git.add({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      filepath: 'src/utils/helpers.txt',
    })
    await git.commit({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      author: { name: 'Collaborator', email: 'collab@example.com' },
      message: 'Improve docs and helpers',
    })
    await git.checkout({
      fs: fsRef.current,
      dir: remotePath,
      gitdir: remoteGitdir,
      ref: 'main',
    })
    const remoteMetadata = {
      mergeRequests: [
        {
          id: `collab-${Date.now()}`,
          title: 'Collaborator updates',
          slug: 'collaborator_updates',
          status: 'open',
          base: 'main',
          compare: 'collaborator_branch',
        },
      ],
    }
    await pfs.writeFile(
      `${remotePath}/.edu_git_remote.json`,
      JSON.stringify(remoteMetadata, null, 2)
    )
  }

  const mockEnvironment = async () => {
    const snapshotString = await createSnapshotFromSeed(pfs, seedMockEnvironment, {
      selectedFilePath: '/README.txt',
      openFilePaths: ['/README.txt'],
    })
    await loadEnvironment(snapshotString)
  }

  const mockConflictEnvironment = async () => {
    await clearRoot(pfs)
    const result = await seedMockConflictEnvironment({ fs: fsRef.current, pfs })
    await refreshTree()
    const openPath = result?.openFilePath || '/src/utils/helpers.txt'
    setSelectedFilePath(openPath)
    setOpenFilePaths([openPath])
    setResetToken((prev) => prev + 1)
  }

  const exportWorkspaceState = async () => {
    try {
      const entries = await exportFileSystem(pfs, '/')
      const mergeRequests =
        typeof window !== 'undefined' ? window.__eduGitMergeRequests || [] : []
      return createSnapshotString({
        entries,
        ui: {
          selectedFilePath,
          openFilePaths,
        },
        mergeRequests,
      })
    } catch (error) {
      return null
    }
  }

  const importWorkspaceState = async (snapshotString) => {
    return loadEnvironment(snapshotString)
  }

  const value = {
    fs: fsRef.current,
    gitFs: fsRef.current.promises,
    tree,
    isReady,
    resetToken,
    selectedFile,
    selectedFilePath,
    openFilePaths,
    openFiles,
    selectFile,
    openFile,
    closeFile,
    updateFileContent,
    createFile,
    createFolder,
    deleteNode,
    renameNode,
    statPath,
    readDirectory,
    readTextFile,
    resetInstance,
    mockEnvironment,
    mockConflictEnvironment,
    loadEnvironment,
    exportWorkspaceState,
    importWorkspaceState,
    refreshTree,
  }

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  )
}

export { FileSystemContext, FileSystemProvider }
