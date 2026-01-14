import { useContext, useEffect, useRef, useState } from 'react'
import './WorkspaceMenu.css'
import { FileSystemContext } from '../../store/FileSystemContext'
import RemoteRepoModal from '../remote-repo/RemoteRepoModal'

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
  const { mockEnvironment, resetInstance } = useContext(FileSystemContext)

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

  return (
    <div className="floating-menu" ref={menuRef}>
      <button
        type="button"
        className="floating-menu__toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        Workspace Menu
      </button>
      {isOpen && (
        <div className="floating-menu__panel">
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              setRemoteOpen(true)
              setIsOpen(false)
            }}
          >
            Remote Repo UI
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              await mockEnvironment()
              setIsOpen(false)
            }}
          >
            Mock Complex Environment
          </button>
          <button
            type="button"
            className="floating-menu__item"
            onClick={async () => {
              await resetInstance()
              setIsOpen(false)
            }}
          >
            Reset Instance
          </button>
        </div>
      )}
      <RemoteRepoModal
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
    </div>
  )
}

export default WorkspaceMenu
