import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import './TerminalPane.css'
import { FileSystemContext } from '../store/FileSystemContext'

const PROMPT_USER = 'edu-git@mock'

const normalizePath = (input, cwdPath) => {
  if (!input || input === '.') {
    return cwdPath
  }
  const isAbsolute = input.startsWith('/')
  const base = isAbsolute ? [] : cwdPath.split('/').filter(Boolean)
  const parts = input.split('/').filter((segment) => segment.length > 0)
  const stack = [...base]
  for (const part of parts) {
    if (part === '.') {
      continue
    }
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join('/')}`
}

const getNodeByPath = (tree, path) => {
  if (path === '/') {
    return { id: 'root', type: 'folder', name: '/', children: tree }
  }
  const segments = path.split('/').filter(Boolean)
  let current = { children: tree }
  for (const segment of segments) {
    const next = current.children?.find((node) => node.name === segment)
    if (!next) {
      return null
    }
    current = next
  }
  return current
}

const splitPath = (path) => {
  if (path === '/') {
    return { dirPath: '/', name: '' }
  }
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() || ''
  return { dirPath: `/${segments.join('/')}`, name }
}

function TerminalPane() {
  const { tree, createFile, createFolder } = useContext(FileSystemContext)
  const [cwdPath, setCwdPath] = useState('/src')
  const [lines, setLines] = useState([
    { type: 'output', text: 'Welcome to edu-git terminal. Type "help" to begin.' },
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [gitInitialized, setGitInitialized] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)

  const prompt = useMemo(() => `${PROMPT_USER}:${cwdPath} $`, [cwdPath])

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [lines])

  const appendOutput = (outputLines) => {
    setLines((prev) => [
      ...prev,
      ...outputLines.map((text) => ({ type: 'output', text })),
    ])
  }

  const handleCommand = (rawInput) => {
    const trimmed = rawInput.trim()
    if (!trimmed) {
      return
    }
    const [command, ...args] = trimmed.split(' ')

    if (command === 'help') {
      appendOutput([
        'Basic commands:',
        '  help            Show this help panel',
        '  pwd             Print the current directory',
        '  ls [path]        List files in a directory',
        '  cd [path]        Change directory',
        '  cat <file>       Print a text file',
        '  touch <file>     Create a new text file',
        '  mkdir <folder>   Create a new folder',
        '  clear            Clear the terminal output',
      ])
      return
    }

    if (command === 'pwd') {
      appendOutput([cwdPath])
      return
    }

    if (command === 'ls') {
      const targetPath = normalizePath(args[0] || '.', cwdPath)
      const node = getNodeByPath(tree, targetPath)
      if (!node || node.type !== 'folder') {
        appendOutput([`ls: cannot access '${args[0] || '.'}': No such directory`])
        return
      }
      const listing = node.children.map((child) => child.name).join('  ')
      appendOutput([listing || ''])
      return
    }

    if (command === 'cd') {
      const targetPath = normalizePath(args[0] || '/', cwdPath)
      const node = getNodeByPath(tree, targetPath)
      if (!node || node.type !== 'folder') {
        appendOutput([`cd: ${args[0] || '/'}: No such directory`])
        return
      }
      setCwdPath(targetPath)
      return
    }

    if (command === 'cat') {
      const targetPath = normalizePath(args[0], cwdPath)
      const node = getNodeByPath(tree, targetPath)
      if (!node || node.type !== 'file') {
        appendOutput([`cat: ${args[0]}: No such file`])
        return
      }
      const contentLines = node.content ? node.content.split('\n') : ['']
      appendOutput(contentLines)
      return
    }

    if (command === 'touch') {
      const targetPath = normalizePath(args[0], cwdPath)
      const { dirPath, name } = splitPath(targetPath)
      if (!name) {
        appendOutput(['touch: missing file operand'])
        return
      }
      const parent = getNodeByPath(tree, dirPath)
      if (!parent || parent.type !== 'folder') {
        appendOutput([`touch: cannot create file in '${dirPath}'`])
        return
      }
      const created = createFile({
        parentId: parent.id === 'root' ? null : parent.id,
        name,
      })
      if (!created) {
        appendOutput([`touch: ${name}: File already exists`])
      }
      return
    }

    if (command === 'mkdir') {
      const targetPath = normalizePath(args[0], cwdPath)
      const { dirPath, name } = splitPath(targetPath)
      if (!name) {
        appendOutput(['mkdir: missing operand'])
        return
      }
      const parent = getNodeByPath(tree, dirPath)
      if (!parent || parent.type !== 'folder') {
        appendOutput([`mkdir: cannot create directory '${dirPath}'`])
        return
      }
      const created = createFolder({ parentId: parent.id === 'root' ? null : parent.id, name })
      if (!created) {
        appendOutput([`mkdir: cannot create directory '${name}': File exists`])
      }
      return
    }

    if (command === 'clear') {
      setLines([])
      return
    }

    if (command === 'git') {
      const subcommand = args[0]
      if (subcommand === 'init') {
        setGitInitialized(true)
        appendOutput(['Initialized empty Git repository in /repo/.git/'])
        return
      }
      if (subcommand === 'status') {
        if (!gitInitialized) {
          appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
          return
        }
        appendOutput(['On branch main', 'nothing to commit, working tree clean'])
        return
      }
      appendOutput([`git: unknown command ${subcommand || ''}`])
      return
    }

    appendOutput([`${command}: command not found`])
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const current = input
    setLines((prev) => [...prev, { type: 'input', text: `${prompt} ${current}` }])
    if (current.trim()) {
      setHistory((prev) => [...prev, current])
    }
    setHistoryIndex(-1)
    setInput('')
    handleCommand(current)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHistoryIndex((prev) => {
        const nextIndex = prev < 0 ? history.length - 1 : Math.max(prev - 1, 0)
        setInput(history[nextIndex] || '')
        return nextIndex
      })
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHistoryIndex((prev) => {
        const nextIndex = prev < 0 ? -1 : Math.min(prev + 1, history.length - 1)
        setInput(nextIndex >= 0 ? history[nextIndex] || '' : '')
        return nextIndex
      })
    }
  }

  return (
    <div className="terminal-pane" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-pane__header">Terminal</div>
      <div className="terminal-pane__body" ref={bodyRef}>
        {lines.map((line, index) => (
          <div className="terminal-pane__line" key={`${line.type}-${index}`}>
            {line.text}
          </div>
        ))}
        <form className="terminal-pane__prompt" onSubmit={handleSubmit}>
          <span className="terminal-pane__prompt-label">{prompt}</span>
          <div
            className="terminal-pane__input-wrap"
            style={{ '--cursor-offset': `${input.length}ch` }}
          >
            <input
              ref={inputRef}
              className="terminal-pane__input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck="false"
              autoCapitalize="off"
              autoComplete="off"
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
            <span
              className={`terminal-pane__cursor ${
                isFocused ? 'terminal-pane__cursor--active' : ''
              }`}
              aria-hidden="true"
            />
          </div>
        </form>
      </div>
    </div>
  )
}

export default TerminalPane
