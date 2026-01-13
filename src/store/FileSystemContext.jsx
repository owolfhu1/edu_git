import { createContext, useMemo, useState } from 'react'

const FileSystemContext = createContext(null)

const initialTree = [
  {
    id: 'folder-src',
    name: 'src',
    type: 'folder',
    children: [
      {
        id: 'file-readme',
        name: 'README.tst',
        type: 'file',
        content: `# Git Practice\n\nStart by making your first commit.\n\n- Create a file\n- Stage the file\n- Commit the changes\n`,
      },
    ],
  },
]

const readNode = (nodes, id) => {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (node.type === 'folder') {
      const found = readNode(node.children, id)
      if (found) {
        return found
      }
    }
  }
  return null
}

const updateNode = (nodes, id, updater) =>
  nodes.map((node) => {
    if (node.id === id) {
      return updater(node)
    }
    if (node.type === 'folder') {
      return { ...node, children: updateNode(node.children, id, updater) }
    }
    return node
  })

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

const findSiblings = (nodes, parentId) => {
  if (!parentId) {
    return nodes
  }
  const parent = readNode(nodes, parentId)
  if (parent?.type !== 'folder') {
    return null
  }
  return parent.children
}

const findParentId = (nodes, targetId, parentId = null) => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return parentId
    }
    if (node.type === 'folder') {
      const found = findParentId(node.children, targetId, node.id)
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

const removeNode = (nodes, id) =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) => {
      if (node.type === 'folder') {
        return { ...node, children: removeNode(node.children, id) }
      }
      return node
    })

const collectNodeIds = (node) => {
  if (!node) {
    return []
  }
  if (node.type === 'folder') {
    return [node.id, ...node.children.flatMap(collectNodeIds)]
  }
  return [node.id]
}

function FileSystemProvider({ children }) {
  const [tree, setTree] = useState(initialTree)
  const [selectedFileId, setSelectedFileId] = useState('file-readme')
  const [openFileIds, setOpenFileIds] = useState(['file-readme'])

  const selectedFile = useMemo(
    () => readNode(tree, selectedFileId),
    [tree, selectedFileId]
  )
  const openFiles = useMemo(
    () => openFileIds.map((id) => readNode(tree, id)).filter(Boolean),
    [tree, openFileIds]
  )

  const selectFile = (id) => {
    const target = readNode(tree, id)
    if (target?.type === 'file') {
      setSelectedFileId(id)
    }
  }

  const openFile = (id) => {
    const target = readNode(tree, id)
    if (!target || target.type !== 'file') {
      return
    }
    setOpenFileIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setSelectedFileId(id)
  }

  const closeFile = (id) => {
    setOpenFileIds((prev) => {
      const remaining = prev.filter((fileId) => fileId !== id)
      setSelectedFileId((prevSelected) => {
        if (prevSelected !== id) {
          return prevSelected
        }
        return remaining[remaining.length - 1] || null
      })
      return remaining
    })
  }

  const updateFileContent = (id, content) => {
    setTree((prev) =>
      updateNode(prev, id, (node) => ({ ...node, content }))
    )
  }

  const createFile = ({ parentId, name, content = '' }) => {
    const fileName = normalizeFileName(name)
    if (!fileName) {
      return false
    }
    const siblings = findSiblings(tree, parentId)
    if (!siblings || siblings.some((node) => node.name === fileName)) {
      return false
    }
    const newFile = {
      id: `file-${Date.now()}`,
      name: fileName,
      type: 'file',
      content,
    }

    setTree((prev) => {
      if (!parentId) {
        return [...prev, newFile]
      }
      return updateNode(prev, parentId, (node) => ({
        ...node,
        children: [...node.children, newFile],
      }))
    })
    return true
  }

  const createFolder = ({ parentId, name }) => {
    const siblings = findSiblings(tree, parentId)
    if (!siblings || siblings.some((node) => node.name === name)) {
      return false
    }
    const newFolder = {
      id: `folder-${Date.now()}`,
      name,
      type: 'folder',
      children: [],
    }

    setTree((prev) => {
      if (!parentId) {
        return [...prev, newFolder]
      }
      return updateNode(prev, parentId, (node) => ({
        ...node,
        children: [...node.children, newFolder],
      }))
    })
    return true
  }

  const deleteNode = (id) => {
    const target = readNode(tree, id)
    if (!target) {
      return
    }
    const idsToRemove = collectNodeIds(target)
    setTree((prev) => removeNode(prev, id))
    setOpenFileIds((prev) => prev.filter((fileId) => !idsToRemove.includes(fileId)))
    setSelectedFileId((prevSelected) =>
      idsToRemove.includes(prevSelected) ? null : prevSelected
    )
  }

  const renameNode = (id, name) => {
    const target = readNode(tree, id)
    if (!target) {
      return false
    }
    const parentId = findParentId(tree, id)
    const siblings = findSiblings(tree, parentId)
    if (!siblings) {
      return false
    }
    const nextName = target.type === 'file' ? normalizeFileName(name) : name.trim()
    if (!nextName) {
      return false
    }
    const duplicate = siblings.some(
      (node) => node.id !== id && node.name === nextName
    )
    if (duplicate) {
      return false
    }
    setTree((prev) =>
      updateNode(prev, id, (node) => ({
        ...node,
        name: nextName,
      }))
    )
    return true
  }

  const value = {
    tree,
    selectedFile,
    selectedFileId,
    openFileIds,
    openFiles,
    selectFile,
    openFile,
    closeFile,
    updateFileContent,
    createFile,
    createFolder,
    deleteNode,
    renameNode,
  }

  return (
    <FileSystemContext.Provider value={value}>
      {children}
    </FileSystemContext.Provider>
  )
}

export { FileSystemContext, FileSystemProvider }
