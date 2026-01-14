import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import './EditorArea.css'
import WorkspaceMenu from './WorkspaceMenu'
import { FileSystemContext } from '../store/FileSystemContext'

function EditorArea() {
  const {
    openFiles,
    selectedFile,
    selectedFilePath,
    selectFile,
    closeFile,
    updateFileContent,
  } = useContext(FileSystemContext)
  const gutterRef = useRef(null)
  const editorRef = useRef(null)
  const measureRef = useRef(null)
  const lastFilePathRef = useRef(null)
  const [lineMeta, setLineMeta] = useState({ heights: [1], lineHeight: 24 })

  const ensureTrailingBreak = () => {
    if (!editorRef.current) {
      return
    }
    const editor = editorRef.current
    const nodes = Array.from(editor.childNodes)
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i]
      if (node.nodeType === Node.TEXT_NODE && node.textContent === '') {
        editor.removeChild(node)
        continue
      }
      break
    }
    let trailingBreaks = 0
    for (let i = editor.childNodes.length - 1; i >= 0; i -= 1) {
      const node = editor.childNodes[i]
      if (node.nodeName === 'BR') {
        trailingBreaks += 1
      } else {
        break
      }
    }
    while (trailingBreaks > 1) {
      editor.removeChild(editor.lastChild)
      trailingBreaks -= 1
    }
    if (trailingBreaks === 0) {
      editor.appendChild(document.createElement('br'))
    }
  }

  const handleChange = (event) => {
    if (!selectedFile) {
      return
    }
    const rawText = (event.currentTarget.textContent || '').replace(/\u00a0/g, ' ')
    if (rawText !== selectedFile.content) {
      updateFileContent(selectedFile.id, rawText)
    }
    requestAnimationFrame(updateLineMetrics)
  }

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    const currentText = editorRef.current.textContent || ''
    const activePath = selectedFile?.path || null
    const isFocused = document.activeElement === editorRef.current
    const isSameFile = lastFilePathRef.current === activePath
    if (selectedFile && (!isSameFile || !isFocused) && currentText !== selectedFile.content) {
      editorRef.current.textContent = selectedFile.content
    }
    if (editorRef.current && !editorRef.current.querySelector('br')) {
      editorRef.current.appendChild(document.createElement('br'))
    }
    lastFilePathRef.current = activePath
  }, [selectedFile])

  const updateLineMetrics = useCallback(() => {
    if (!editorRef.current || !measureRef.current) {
      return
    }
    const computed = window.getComputedStyle(editorRef.current)
    const lineHeight = Number.parseFloat(computed.lineHeight || '0') || 1
    const content = selectedFile?.content || ''
    const logicalLines = content.split('\n')
    measureRef.current.style.width = `${editorRef.current.clientWidth}px`
    measureRef.current.style.fontFamily = computed.fontFamily
    measureRef.current.style.fontSize = computed.fontSize
    measureRef.current.style.lineHeight = computed.lineHeight
    const heights = logicalLines.map((line) => {
      measureRef.current.textContent = line.length === 0 ? ' ' : line
      const height = measureRef.current.getBoundingClientRect().height
      const rows = Math.max(1, Math.round(height / lineHeight))
      return rows
    })
    setLineMeta({ heights, lineHeight })
  }, [selectedFile])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }
    updateLineMetrics()
    const resizeObserver = new ResizeObserver(updateLineMetrics)
    resizeObserver.observe(editorRef.current)
    window.addEventListener('resize', updateLineMetrics)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateLineMetrics)
    }
  }, [updateLineMetrics])

  const lineNumbers = useMemo(
    () => lineMeta.heights.map((rows, index) => ({ line: index + 1, rows })),
    [lineMeta.heights]
  )

  return (
    <div className="editor-area">
      <div className="editor-area__tabs">
        <div className="editor-area__tabs-left">
          <div className="editor-area__tabs-scroll">
            {openFiles.length === 0 ? (
              <div className="editor-area__tab editor-area__tab--empty">No files open</div>
            ) : (
              openFiles.map((file) => (
                <button
                  className={`editor-area__tab ${
                    selectedFilePath === file.id ? 'editor-area__tab--active' : ''
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
        </div>
        <div className="editor-area__tabs-right">
          <WorkspaceMenu />
        </div>
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
              {lineNumbers.map(({ line, rows }) => (
                <div
                  key={line}
                  className="editor-area__gutter-line"
                  style={{ height: `${rows * lineMeta.lineHeight}px` }}
                >
                  {line}
                </div>
              ))}
            </div>
            <div
              className="editor-area__textarea"
              role="textbox"
              aria-multiline="true"
              contentEditable="plaintext-only"
              suppressContentEditableWarning
              spellCheck="false"
              onInput={(event) => {
                handleChange(event)
                ensureTrailingBreak()
              }}
              onClick={ensureTrailingBreak}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (editorRef.current) {
                    const trailingBreak = document.createElement('br')
                    editorRef.current.appendChild(trailingBreak)
                  }
                }
              }}
              ref={editorRef}
            />
            <div className="editor-area__measure" ref={measureRef} aria-hidden="true" />
          </div>
        ) : (
          <div className="editor-area__empty">Select a file to start editing.</div>
        )}
      </div>
    </div>
  )
}

export default EditorArea
