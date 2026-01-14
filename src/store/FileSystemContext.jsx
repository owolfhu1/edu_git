import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LightningFS from '@isomorphic-git/lightning-fs'
import readmeContent from '../content/README.txt?raw'
import gitCheatSheetContent from '../content/GIT_CHEAT_SHEET.txt?raw'
import mockReadmeContent from '../content/MOCK_README.txt?raw'
import mockDocsOverviewContent from '../content/MOCK_DOCS_OVERVIEW.txt?raw'
import mockDocsSetupContent from '../content/MOCK_DOCS_SETUP.txt?raw'
import mockSrcIndexContent from '../content/MOCK_SRC_INDEX.txt?raw'
import mockComponentAppContent from '../content/MOCK_COMPONENT_APP.txt?raw'
import mockComponentSidebarContent from '../content/MOCK_COMPONENT_SIDEBAR.txt?raw'
import mockUtilsHelpersContent from '../content/MOCK_UTILS_HELPERS.txt?raw'
import mockNotesIdeasContent from '../content/MOCK_NOTES_IDEAS.txt?raw'

const FileSystemContext = createContext(null)

const normalizeFileName = (name) => {
  const trimmed = name.trim()
  if (!trimmed) {
    return ''
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
    entries.map(async (entry) => {
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
  await Promise.all(entries.map((entry) => removePath(pfs, joinPath('/', entry))))
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
    const entries = await pfs.readdir(targetPath)
    await Promise.all(
      entries.map((entry) => removePath(pfs, joinPath(targetPath, entry)))
    )
    try {
      await pfs.rmdir(targetPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
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

  const refreshTree = useCallback(async () => {
    const nextTree = await buildTree(pfs, '/')
    setTree(nextTree)
  }, [pfs])

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

  const seedDefault = useCallback(async () => {
    await ensureDir(pfs, '/src')
    await ensureFile(pfs, '/src/README.txt', readmeContent)
    await ensureFile(pfs, '/GIT_CHEAT_SHEET.txt', gitCheatSheetContent)
  }, [pfs])

  useEffect(() => {
    const bootstrap = async () => {
      await clearRoot(pfs)
      await seedDefault()
      await refreshTree()
      setIsReady(true)
    }
    bootstrap()
  }, [refreshTree, seedDefault])

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
    await clearRoot(pfs)
    await seedDefault()
    await refreshTree()
    setSelectedFilePath('/src/README.txt')
    setOpenFilePaths(['/src/README.txt'])
  }

  const mockEnvironment = async () => {
    await clearRoot(pfs)
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
    await refreshTree()
    setSelectedFilePath('/README.txt')
    setOpenFilePaths(['/README.txt'])
  }

  const value = {
    fs: fsRef.current,
    gitFs: fsRef.current.promises,
    tree,
    isReady,
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
    refreshTree,
  }

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  )
}

export { FileSystemContext, FileSystemProvider }
