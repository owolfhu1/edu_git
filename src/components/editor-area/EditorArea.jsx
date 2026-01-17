import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import './EditorArea.css'
import WorkspaceMenu from '../workspace-menu/WorkspaceMenu'
import { FileSystemContext } from '../../store/FileSystemContext'
import { buildGutterMarks } from '../../git/diff'
import { findGitRootForPath } from '../../git/paths'
import { readBlobAtPath } from '../../git/read'

function EditorArea() {
  const {
    openFiles,
    selectedFile,
    selectedFilePath,
    selectFile,
    closeFile,
    updateFileContent,
    gitFs,
    statPath,
    gitRefreshToken,
  } = useContext(FileSystemContext)
  const gutterRef = useRef(null)
  const editorRef = useRef(null)
  const measureRef = useRef(null)
  const lastFilePathRef = useRef(null)
  const [lineMeta, setLineMeta] = useState({ heights: [1], lineHeight: 24 })
  const [gutterMarks, setGutterMarks] = useState({
    addedLines: new Set(),
    modifiedLines: new Set(),
    removedMarkers: new Set(),
    changeMap: new Map(),
    changes: [],
  })
  const [gutterMenu, setGutterMenu] = useState(null)

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

  useEffect(() => {
    let cancelled = false
    const updateMarks = async () => {
      if (!selectedFilePath || !selectedFile) {
        if (!cancelled) {
          setGutterMarks({
            addedLines: new Set(),
            modifiedLines: new Set(),
            removedMarkers: new Set(),
            changeMap: new Map(),
            changes: [],
          })
        }
        return
      }
      const root = await findGitRootForPath(selectedFilePath, statPath)
      if (!root) {
        if (!cancelled) {
          setGutterMarks({
            addedLines: new Set(),
            modifiedLines: new Set(),
            removedMarkers: new Set(),
            changeMap: new Map(),
            changes: [],
          })
        }
        return
      }
      const gitdir = `${root === '/' ? '' : root}/.git`
      const relativePath = selectedFilePath.startsWith(root)
        ? selectedFilePath.slice(root.length).replace(/^\/+/, '')
        : selectedFilePath.replace(/^\/+/, '')
      const oldText = await readBlobAtPath(gitFs, root, gitdir, 'HEAD', relativePath)
      const newText = selectedFile.content || ''
      const marks = buildGutterMarks(oldText, newText)
      if (!cancelled) {
        setGutterMarks(marks)
      }
    }
    updateMarks()
    return () => {
      cancelled = true
    }
  }, [gitFs, selectedFile, selectedFilePath, statPath, gitRefreshToken])

  useEffect(() => {
    if (!gutterMenu) {
      return undefined
    }
    const handleOutside = (event) => {
      if (!event.target.closest('.editor-area__gutter-menu')) {
        setGutterMenu(null)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [gutterMenu])

  const formatDiffSnippet = (change) => {
    if (!change) {
      return []
    }
    if (change.type === 'add') {
      return change.newLines.map((line) => `+ ${line}`)
    }
    if (change.type === 'delete') {
      return change.oldLines.map((line) => `- ${line}`)
    }
    return [
      ...change.oldLines.map((line) => `- ${line}`),
      ...change.newLines.map((line) => `+ ${line}`),
    ]
  }

  const handleRevertChange = () => {
    if (!gutterMenu || !selectedFile) {
      return
    }
    const { change } = gutterMenu
    const currentLines = (selectedFile.content || '').split('\n')
    let nextLines
    if (change.type === 'delete') {
      const insertIndex = Math.max(0, change.newStart - 1)
      nextLines = [
        ...currentLines.slice(0, insertIndex),
        ...change.oldLines,
        ...currentLines.slice(insertIndex),
      ]
    } else {
      const startIndex = Math.max(0, change.newStart - 1)
      const endIndex = Math.max(startIndex, change.newEnd)
      nextLines = [
        ...currentLines.slice(0, startIndex),
        ...change.oldLines,
        ...currentLines.slice(endIndex),
      ]
    }
    updateFileContent(selectedFile.id, nextLines.join('\n'))
    setGutterMenu(null)
  }

  return (
    <div className="editor-area" data-cy="editor-area">
      <div className="editor-area__tabs" data-cy="editor-tabs">
        <div className="editor-area__tabs-left">
          <div className="editor-area__tabs-scroll" data-cy="editor-tabs-scroll">
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
                  title={`ROOT${file.path}`}
                  data-cy="editor-tab"
                  data-path={file.id}
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
      <div className="editor-area__content" data-cy="editor-content">
        {selectedFile ? (
          <div className="editor-area__editor">
            <div className="editor-area__gutter" aria-hidden="true" ref={gutterRef}>
              {lineNumbers.map(({ line, rows }) => (
                <div
                  key={line}
                  className={`editor-area__gutter-line ${
                    gutterMarks.modifiedLines.has(line)
                      ? 'editor-area__gutter-line--modified'
                      : gutterMarks.addedLines.has(line)
                        ? 'editor-area__gutter-line--add'
                        : ''
                  } ${gutterMarks.removedMarkers.has(line) ? 'editor-area__gutter-line--removed' : ''}`}
                  style={{ height: `${rows * lineMeta.lineHeight}px` }}
                  onContextMenu={(event) => {
                    const change = gutterMarks.changeMap.get(line)
                    if (!change) {
                      return
                    }
                    event.preventDefault()
                    setGutterMenu({
                      x: event.clientX,
                      y: event.clientY,
                      line,
                      change,
                    })
                  }}
                  onClick={(event) => {
                    const change = gutterMarks.changeMap.get(line)
                    if (!change) {
                      return
                    }
                    event.preventDefault()
                    setGutterMenu({
                      x: event.clientX,
                      y: event.clientY,
                      line,
                      change,
                    })
                  }}
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
              data-cy="editor-textarea"
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
            {gutterMenu ? (
              <div
                className="editor-area__gutter-menu"
                style={{ top: gutterMenu.y, left: gutterMenu.x }}
                role="menu"
              >
                <div className="editor-area__gutter-menu-title">
                  Diff at line {gutterMenu.line}
                </div>
                <pre className="editor-area__gutter-menu-diff">
                  {formatDiffSnippet(gutterMenu.change)
                    .slice(0, 12)
                    .map((line, index) => (
                      <span
                        key={`${line}-${index}`}
                        className={
                          line.startsWith('+')
                            ? 'editor-area__gutter-menu-diff--add'
                            : line.startsWith('-')
                              ? 'editor-area__gutter-menu-diff--del'
                              : ''
                        }
                      >
                        {line}
                        {'\n'}
                      </span>
                    ))}
                </pre>
                <button
                  className="editor-area__gutter-menu-action"
                  type="button"
                  onClick={handleRevertChange}
                >
                  Revert change
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="editor-area__empty">Select a file to start editing.</div>
        )}
      </div>
    </div>
  )
}

export default EditorArea
