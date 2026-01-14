import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import './FileStructure.css'
import { FileSystemContext } from '../store/FileSystemContext'

function FileStructure() {
  const {
    tree,
    selectedFileId,
    openFile,
    createFile,
    createFolder,
    deleteNode,
    renameNode,
  } = useContext(FileSystemContext)
  const [menuState, setMenuState] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    targetId: null,
    targetType: null,
  })
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [contextSubmenuOpen, setContextSubmenuOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(['folder-src']))
  const [createState, setCreateState] = useState({
    isOpen: false,
    type: 'file',
    parentId: null,
    name: '',
    error: '',
  })
  const [deleteState, setDeleteState] = useState({
    isOpen: false,
    targetId: null,
    targetType: null,
    targetPath: '',
  })
  const [renameState, setRenameState] = useState({
    isOpen: false,
    targetId: null,
    targetType: null,
    name: '',
    error: '',
    targetPath: '',
  })
  const menuRef = useRef(null)
  const deleteModalRef = useRef(null)

  const startCreate = (type, parentId = null) => {
    setCreateState({
      isOpen: true,
      type,
      parentId,
      name: '',
      error: '',
    })
  }

  const handleCreateConfirm = () => {
    const name = createState.name.trim()
    if (!name) {
      setCreateState((prev) => ({ ...prev, error: 'Name is required.' }))
      return
    }
    if (createState.type === 'folder') {
      const created = createFolder({ parentId: createState.parentId, name })
      if (!created) {
        setCreateState((prev) => ({
          ...prev,
          error: 'A file or folder with this name already exists.',
        }))
        return
      }
    } else {
      const created = createFile({
        parentId: createState.parentId,
        name,
        autoOpen: true,
      })
      if (!created?.id) {
        setCreateState((prev) => ({
          ...prev,
          error: 'A file or folder with this name already exists.',
        }))
        return
      }
    }
    setCreateState((prev) => ({ ...prev, isOpen: false, name: '', error: '' }))
  }

  const handleDeleteConfirm = () => {
    if (deleteState.targetId) {
      deleteNode(deleteState.targetId)
    }
    setDeleteState({ isOpen: false, targetId: null, targetType: null, targetPath: '' })
  }

  const handleRenameConfirm = () => {
    const name = renameState.name.trim()
    if (!name) {
      setRenameState((prev) => ({ ...prev, error: 'Name is required.' }))
      return
    }
    const renamed = renameNode(renameState.targetId, name)
    if (!renamed) {
      setRenameState((prev) => ({
        ...prev,
        error: 'A file or folder with this name already exists.',
      }))
      return
    }
    setRenameState({
      isOpen: false,
      targetId: null,
      targetType: null,
      name: '',
      error: '',
      targetPath: '',
    })
  }

  const handleContextMenu = (event, nodeId, nodeType) => {
    event.preventDefault()
    setMenuState({
      isOpen: true,
      x: event.clientX,
      y: event.clientY,
      targetId: nodeId,
      targetType: nodeType,
    })
    setContextSubmenuOpen(false)
  }

  const closeMenu = () => {
    setMenuState((prev) => ({ ...prev, isOpen: false }))
    setContextSubmenuOpen(false)
  }

  useEffect(() => {
    if (!menuState.isOpen) {
      return undefined
    }
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        closeMenu()
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuState.isOpen])

  useEffect(() => {
    if (deleteState.isOpen && deleteModalRef.current) {
      deleteModalRef.current.focus()
    }
  }, [deleteState.isOpen])

  const menuStyle = useMemo(
    () => ({ left: `${menuState.x}px`, top: `${menuState.y}px` }),
    [menuState.x, menuState.y]
  )

  const renderNodes = (nodes) =>
    nodes.map((node) => {
      if (node.type === 'folder') {
        const isExpanded = expandedFolders.has(node.id)
        return (
          <li className="file-structure__item" key={node.id}>
            <div className="file-structure__folder-row">
              <button
                type="button"
                className="file-structure__chevron"
                aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                onClick={() => {
                  setExpandedFolders((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.id)) {
                      next.delete(node.id)
                    } else {
                      next.add(node.id)
                    }
                    return next
                  })
                }}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
              <span
                className="file-structure__folder"
                onContextMenu={(event) => handleContextMenu(event, node.id, node.type)}
                onClick={() => {
                  setExpandedFolders((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.id)) {
                      next.delete(node.id)
                    } else {
                      next.add(node.id)
                    }
                    return next
                  })
                }}
              >
                {node.name}
              </span>
            </div>
            {isExpanded && (
              <ul className="file-structure__nested">{renderNodes(node.children)}</ul>
            )}
          </li>
        )
      }

      const isActive = selectedFileId === node.id
      return (
        <li
          className={`file-structure__file ${
            isActive ? 'file-structure__file--active' : ''
          }`}
          key={node.id}
          onContextMenu={(event) => handleContextMenu(event, node.id, node.type)}
        >
          <button type="button" onClick={() => openFile(node.id)}>
            {node.name}
          </button>
        </li>
      )
    })

  const findNodePath = (nodes, targetId, parentPath = '') => {
    for (const node of nodes) {
      const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name
      if (node.id === targetId) {
        return currentPath
      }
      if (node.type === 'folder') {
        const found = findNodePath(node.children, targetId, currentPath)
        if (found) {
          return found
        }
      }
    }
    return ''
  }

  const stripTxtExtension = (name) => {
    if (!name) {
      return ''
    }
    if (name.toLowerCase().endsWith('.txt')) {
      return name.slice(0, -4)
    }
    if (name.includes('.')) {
      return name.slice(0, name.lastIndexOf('.'))
    }
    return name
  }

  return (
    <div className="file-structure">
      <div className="file-structure__header">
        <span>Files</span>
        <div className="file-structure__new">
          <button
            className="file-structure__button"
            type="button"
            onClick={() => setSubmenuOpen((prev) => !prev)}
          >
            + New
          </button>
          {submenuOpen && (
            <div className="file-structure__submenu">
              <button
                type="button"
                className="file-structure__submenu-item"
                onClick={() => {
                  startCreate('file')
                  setSubmenuOpen(false)
                }}
              >
                New File
              </button>
              <button
                type="button"
                className="file-structure__submenu-item"
                onClick={() => {
                  startCreate('folder')
                  setSubmenuOpen(false)
                }}
              >
                New Folder
              </button>
            </div>
          )}
        </div>
      </div>
      <ul className="file-structure__tree">{renderNodes(tree)}</ul>
      {menuState.isOpen && (
        <div className="file-structure__menu" style={menuStyle} ref={menuRef}>
          {menuState.targetType === 'folder' && (
            <>
              <button
                type="button"
                className="file-structure__menu-item"
                onClick={() => {
                  setContextSubmenuOpen((prev) => !prev)
                }}
              >
                New
              </button>
              {contextSubmenuOpen && (
                <div className="file-structure__menu-submenu">
                  <button
                    type="button"
                    className="file-structure__menu-item"
                    onClick={() => {
                      startCreate('file', menuState.targetId)
                      closeMenu()
                    }}
                  >
                    New File
                  </button>
                  <button
                    type="button"
                    className="file-structure__menu-item"
                    onClick={() => {
                      startCreate('folder', menuState.targetId)
                      closeMenu()
                    }}
                  >
                    New Folder
                  </button>
                </div>
              )}
            </>
          )}
          {menuState.targetType === 'file' && (
            <button
              type="button"
              className="file-structure__menu-item"
              onClick={() => {
                if (menuState.targetId) {
                  openFile(menuState.targetId)
                }
                closeMenu()
              }}
            >
              Open
            </button>
          )}
          <button
            type="button"
            className="file-structure__menu-item"
            onClick={() => {
              const targetPath = menuState.targetId
                ? findNodePath(tree, menuState.targetId)
                : ''
              const currentName = targetPath
                ? targetPath.split('/').slice(-1)[0]
                : ''
              const displayName =
                menuState.targetType === 'file'
                  ? stripTxtExtension(currentName)
                  : currentName
              setRenameState({
                isOpen: true,
                targetId: menuState.targetId,
                targetType: menuState.targetType,
                name: displayName,
                error: '',
                targetPath,
              })
              closeMenu()
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="file-structure__menu-item file-structure__menu-item--danger"
            onClick={() => {
              const targetPath = menuState.targetId
                ? findNodePath(tree, menuState.targetId)
                : ''
              setDeleteState({
                isOpen: true,
                targetId: menuState.targetId,
                targetType: menuState.targetType,
                targetPath,
              })
              closeMenu()
            }}
          >
            Delete
          </button>
        </div>
      )}
      {createState.isOpen && (
        <div className="file-structure__modal-backdrop">
          <div className="file-structure__modal">
            <h3 className="file-structure__modal-title">
              {createState.type === 'folder' ? 'New Folder' : 'New File'}
            </h3>
            <label className="file-structure__modal-label" htmlFor="create-name">
              Name
            </label>
            <input
              id="create-name"
              className="file-structure__modal-input"
              type="text"
              value={createState.name}
              placeholder={createState.type === 'folder' ? 'assets' : 'notes'}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  name: event.target.value,
                  error: '',
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleCreateConfirm()
                }
              }}
            />
            {createState.error && (
              <p className="file-structure__modal-error">{createState.error}</p>
            )}
            <div className="file-structure__modal-actions">
              <button
                type="button"
                className="file-structure__modal-button"
                onClick={() =>
                  setCreateState((prev) => ({
                    ...prev,
                    isOpen: false,
                    name: '',
                    error: '',
                  }))
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="file-structure__modal-button file-structure__modal-button--primary"
                onClick={handleCreateConfirm}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteState.isOpen && (
        <div className="file-structure__modal-backdrop">
          <div
            className="file-structure__modal"
            ref={deleteModalRef}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleDeleteConfirm()
              }
            }}
          >
            <h3 className="file-structure__modal-title">Delete</h3>
            <p className="file-structure__modal-text">
              {deleteState.targetType === 'folder'
                ? 'Delete this folder and its contents?'
                : 'Delete this file?'}
              {deleteState.targetPath ? ` (${deleteState.targetPath})` : ''}
            </p>
            <div className="file-structure__modal-actions">
              <button
                type="button"
                className="file-structure__modal-button"
                onClick={() =>
                  setDeleteState({
                    isOpen: false,
                    targetId: null,
                    targetType: null,
                    targetPath: '',
                  })
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="file-structure__modal-button file-structure__modal-button--danger"
                onClick={handleDeleteConfirm}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {renameState.isOpen && (
        <div className="file-structure__modal-backdrop">
          <div className="file-structure__modal">
            <h3 className="file-structure__modal-title">
              Rename {renameState.targetType === 'folder' ? 'Folder' : 'File'}
            </h3>
            {renameState.targetPath && (
              <p className="file-structure__modal-text">
                {renameState.targetPath}
              </p>
            )}
            <label className="file-structure__modal-label" htmlFor="rename-name">
              New name
            </label>
            <input
              id="rename-name"
              className="file-structure__modal-input"
              type="text"
              value={renameState.name}
              onChange={(event) =>
                setRenameState((prev) => ({
                  ...prev,
                  name: event.target.value,
                  error: '',
                }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleRenameConfirm()
                }
              }}
            />
            {renameState.error && (
              <p className="file-structure__modal-error">{renameState.error}</p>
            )}
            <div className="file-structure__modal-actions">
              <button
                type="button"
                className="file-structure__modal-button"
                onClick={() =>
                  setRenameState({
                    isOpen: false,
                    targetId: null,
                    targetType: null,
                    name: '',
                    error: '',
                    targetPath: '',
                  })
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="file-structure__modal-button file-structure__modal-button--primary"
                onClick={handleRenameConfirm}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileStructure
