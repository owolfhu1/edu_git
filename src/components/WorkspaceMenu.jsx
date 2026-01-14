import { useContext, useEffect, useRef, useState } from 'react'
import './WorkspaceMenu.css'
import { FileSystemContext } from '../store/FileSystemContext'

function WorkspaceMenu() {
  const [isOpen, setIsOpen] = useState(false)
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
              await resetInstance()
              setIsOpen(false)
            }}
          >
            Reset Instance
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
        </div>
      )}
    </div>
  )
}

export default WorkspaceMenu
