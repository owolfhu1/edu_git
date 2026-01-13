import { useContext, useMemo, useRef } from 'react'
import './EditorArea.css'
import { FileSystemContext } from '../store/FileSystemContext'

function EditorArea() {
  const { openFiles, selectedFile, selectedFileId, selectFile, closeFile, updateFileContent } =
    useContext(FileSystemContext)
  const gutterRef = useRef(null)
  const textareaRef = useRef(null)

  const lineCount = useMemo(() => {
    if (!selectedFile?.content) {
      return 1
    }
    return selectedFile.content.split('\n').length
  }, [selectedFile])

  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount]
  )

  const handleChange = (event) => {
    if (!selectedFile) {
      return
    }
    updateFileContent(selectedFile.id, event.target.value)
  }

  const handleScroll = (event) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.target.scrollTop
    }
  }

  return (
    <div className="editor-area">
      <div className="editor-area__tabs">
        {openFiles.length === 0 ? (
          <div className="editor-area__tab editor-area__tab--empty">No files open</div>
        ) : (
          openFiles.map((file) => (
            <button
              className={`editor-area__tab ${
                selectedFileId === file.id ? 'editor-area__tab--active' : ''
              }`}
              type="button"
              key={file.id}
              onClick={() => selectFile(file.id)}
            >
              <span>{file.name}</span>
              <span
                className="editor-area__tab-close"
                role="button"
                aria-label={`Close ${file.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  closeFile(file.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                    closeFile(file.id)
                  }
                }}
                tabIndex={0}
              >
                ×
              </span>
            </button>
          ))
        )}
      </div>
      <div className="editor-area__toolbar">
        <span className="editor-area__status">Branch: main</span>
        <span className="editor-area__status">
          {selectedFile ? 'Changes: 1' : 'Changes: 0'}
        </span>
      </div>
      <div className="editor-area__content">
        {selectedFile ? (
          <div className="editor-area__editor">
            <div className="editor-area__gutter" aria-hidden="true" ref={gutterRef}>
              {lineNumbers.map((line) => (
                <div key={line} className="editor-area__gutter-line">
                  {line}
                </div>
              ))}
            </div>
            <textarea
              className="editor-area__textarea"
              spellCheck="false"
              value={selectedFile.content}
              onChange={handleChange}
              onScroll={handleScroll}
              ref={textareaRef}
            />
          </div>
        ) : (
          <div className="editor-area__empty">Select a file to start editing.</div>
        )}
      </div>
    </div>
  )
}

export default EditorArea
