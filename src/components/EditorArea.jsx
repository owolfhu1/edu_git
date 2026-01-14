import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import './EditorArea.css'
import WorkspaceMenu from './WorkspaceMenu'
import { FileSystemContext } from '../store/FileSystemContext'

const normalizeGitPath = (path) => path.replace(/^\/+/, '')

const decodeContent = (content) => {
  if (!content) {
    return ''
  }
  if (typeof content === 'string') {
    return content
  }
  return new TextDecoder().decode(content)
}

const readBlobAtPath = async (fs, root, gitdir, ref, targetPath) => {
  const normalizedTarget = normalizeGitPath(targetPath)
  if (!normalizedTarget) {
    return ''
  }
  let treeOid
  try {
    const commitOid = await git.resolveRef({ fs, dir: root, gitdir, ref })
    const { commit } = await git.readCommit({ fs, dir: root, gitdir, oid: commitOid })
    treeOid = commit.tree
  } catch (error) {
    return ''
  }

  const parts = normalizedTarget.split('/')
  let currentTree = treeOid
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const { tree } = await git.readTree({ fs, dir: root, gitdir, oid: currentTree })
    const entry = tree.find((item) => item.path === part)
    if (!entry) {
      return ''
    }
    if (index === parts.length - 1) {
      if (entry.type !== 'blob') {
        return ''
      }
      const { blob } = await git.readBlob({ fs, dir: root, gitdir, oid: entry.oid })
      return decodeContent(blob)
    }
    if (entry.type !== 'tree') {
      return ''
    }
    currentTree = entry.oid
  }
  return ''
}

const findGitRootForPath = async (path, statPath) => {
  let current = path.split('/').slice(0, -1).join('/') || '/'
  while (true) {
    const gitDir = `${current === '/' ? '' : current}/.git`
    const stats = await statPath(gitDir || '/.git')
    if (stats && stats.type === 'dir') {
      return current
    }
    if (current === '/') {
      return null
    }
    current = current.split('/').slice(0, -1).join('/') || '/'
  }
}

const computeDiffOps = (oldText, newText) => {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const rows = oldLines.length
  const cols = newLines.length
  const dp = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0))

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  let i = rows
  let j = cols
  const ops = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', line: oldLines[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', line: newLines[j - 1] })
      j -= 1
    } else {
      ops.push({ type: 'del', line: oldLines[i - 1] })
      i -= 1
    }
  }

  return ops.reverse()
}

const buildGutterMarks = (oldText, newText) => {
  const ops = computeDiffOps(oldText, newText)
  const newLines = newText.split('\n')
  const addedLines = new Set()
  const modifiedLines = new Set()
  const removedMarkers = new Set()
  const changes = []
  const changeMap = new Map()
  let newIndex = 0
  let oldIndex = 0
  let run = null

  const flushRun = () => {
    if (!run) {
      return
    }
    const type =
      run.oldLines.length > 0 && run.newLines.length > 0
        ? 'modify'
        : run.newLines.length > 0
          ? 'add'
          : 'delete'
    const markerLine = Math.min(newLines.length, Math.max(1, run.newStart))
    const change = {
      type,
      oldLines: run.oldLines,
      newLines: run.newLines,
      newStart: run.newStart,
      newEnd: run.newStart + run.newLines.length - 1,
      markerLine,
    }
    changes.push(change)
    if (type === 'delete') {
      removedMarkers.add(markerLine)
      changeMap.set(markerLine, change)
    } else {
      const start = change.newStart
      const end = change.newEnd
      for (let line = start; line <= end; line += 1) {
        if (type === 'add') {
          addedLines.add(line)
        } else {
          modifiedLines.add(line)
        }
        changeMap.set(line, change)
      }
    }
    run = null
  }

  ops.forEach((op) => {
    if (op.type === 'equal') {
      flushRun()
      newIndex += 1
      oldIndex += 1
      return
    }
    if (!run) {
      run = {
        oldLines: [],
        newLines: [],
        newStart: newIndex + 1,
      }
    }
    if (op.type === 'add') {
      run.newLines.push(op.line)
      newIndex += 1
      return
    }
    run.oldLines.push(op.line)
    oldIndex += 1
  })

  flushRun()

  return { addedLines, modifiedLines, removedMarkers, changeMap, changes }
}

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
  }, [gitFs, selectedFile, selectedFilePath, statPath])

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
