import { useContext, useEffect, useRef, useState } from 'react'
import './WorkspaceMenu.css'
import { FileSystemContext } from '../../store/FileSystemContext'
import RemoteRepoModal from '../remote-repo/RemoteRepoModal'

const ExportIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 4v10" />
    <path d="M7.5 8.5L12 4l4.5 4.5" />
    <path d="M5 19.5h14" />
  </svg>
)

const ImportIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20V10" />
    <path d="M16.5 15.5L12 20l-4.5-4.5" />
    <path d="M5 4.5h14" />
  </svg>
)

const RemoteIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7.5 18.2h8.2a4 4 0 0 0 .5-8 5.2 5.2 0 0 0-10-1.4 3.5 3.5 0 0 0 1.3 9.4z" />
  </svg>
)

const MockIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 5.5h10l2 2v9.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z" />
    <path d="M9 10h6M9 13.5h6" />
  </svg>
)

const ResetIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 7v5h5" />
    <path d="M19 12a7 7 0 0 1-12 4.9" />
    <path d="M19 12a7 7 0 0 0-12-4.9" />
  </svg>
)

const normalizeRemotePath = (path) => {
  if (!path) {
    return '/'
  }
  const trimmed = path.trim()
  if (trimmed.startsWith('/')) {
    return trimmed
  }
  return `/${trimmed}`
}

function WorkspaceMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [remoteHistory, setRemoteHistory] = useState(['/'])
  const [remoteIndex, setRemoteIndex] = useState(0)
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0)
  const menuRef = useRef(null)
  const importInputRef = useRef(null)
  const {
    mockEnvironment,
    resetInstance,
    resetToken,
    exportWorkspaceState,
    importWorkspaceState,
  } = useContext(FileSystemContext)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [isOpen])

  useEffect(() => {
    setRemoteOpen(false)
    setRemoteHistory(['/'])
    setRemoteIndex(0)
    setRemoteRefreshKey((prev) => prev + 1)
  }, [resetToken])

  return (
    <div className="floating-menu" ref={menuRef} data-cy="workspace-menu">
      <button
        type="button"
        className="floating-menu__toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-cy="workspace-menu-toggle"
      >
        Workspace Menu
      </button>
      {isOpen && (
        <div className="floating-menu__panel" data-cy="workspace-menu-panel">
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              setRemoteOpen(true)
              setIsOpen(false)
            }}
            data-cy="workspace-menu-remote"
          >
            <span className="floating-menu__icon" aria-hidden="true">
              <RemoteIcon />
            </span>
            Remote Repo UI
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              const snapshotString = await exportWorkspaceState()
              if (!snapshotString) {
                setIsOpen(false)
                return
              }
              const blob = new Blob([snapshotString], { type: 'application/json' })
              const url = window.URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `edu-git-workspace-${Date.now()}.json`
              anchor.click()
              window.URL.revokeObjectURL(url)
              setIsOpen(false)
            }}
            data-cy="workspace-menu-export"
          >
            <span className="floating-menu__icon" aria-hidden="true">
              <ExportIcon />
            </span>
            Export Workspace
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              importInputRef.current?.click()
              setIsOpen(false)
            }}
            data-cy="workspace-menu-import"
          >
            <span className="floating-menu__icon" aria-hidden="true">
              <ImportIcon />
            </span>
            Import Workspace
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              await mockEnvironment()
              setIsOpen(false)
            }}
            data-cy="workspace-menu-mock"
          >
            <span className="floating-menu__icon" aria-hidden="true">
              <MockIcon />
            </span>
            Mock Full Environment
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              await resetInstance()
              setIsOpen(false)
            }}
            data-cy="workspace-menu-reset"
          >
            <span className="floating-menu__icon" aria-hidden="true">
              <ResetIcon />
            </span>
            Reset Instance
          </button>
        </div>
      )}
      <RemoteRepoModal
        key={resetToken}
        isOpen={remoteOpen}
        currentPath={remoteHistory[remoteIndex] || '/'}
        canGoBack={remoteIndex > 0}
        canGoForward={remoteIndex < remoteHistory.length - 1}
        refreshKey={remoteRefreshKey}
        onClose={() => setRemoteOpen(false)}
        onBack={() => setRemoteIndex((prev) => Math.max(0, prev - 1))}
        onForward={() =>
          setRemoteIndex((prev) => Math.min(remoteHistory.length - 1, prev + 1))
        }
        onRefresh={() => setRemoteRefreshKey((prev) => prev + 1)}
        onNavigate={(path) => {
          const nextPath = normalizeRemotePath(path)
          setRemoteIndex((prevIndex) => {
            setRemoteHistory((prevHistory) => {
              const next = prevHistory.slice(0, prevIndex + 1)
              next.push(nextPath)
              return next
            })
            return prevIndex + 1
          })
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        data-cy="workspace-menu-import-input"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) {
            return
          }
          const content = await file.text()
          await importWorkspaceState(content)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export default WorkspaceMenu
