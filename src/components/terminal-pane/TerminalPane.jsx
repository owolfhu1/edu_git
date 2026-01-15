import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import './TerminalPane.css'
import { FileSystemContext } from '../../store/FileSystemContext'
import { createCommands } from '../../terminal/commands'
import { findGitRoot } from '../../git/paths'

const PROMPT_USER = 'edu-git@mock'

function TerminalPane() {
  const {
    fs,
    createFile,
    createFolder,
    deleteNode,
    readDirectory,
    readTextFile,
    statPath,
    refreshTree,
    resetToken,
  } = useContext(FileSystemContext)
  const [cwdPath, setCwdPath] = useState('/')
  const [lines, setLines] = useState([
    { type: 'output', text: 'Welcome to edu-git terminal. Type "help" to begin.' },
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [gitInitialized, setGitInitialized] = useState(false)
  const [gitRoot, setGitRoot] = useState(null)
  const [branchName, setBranchName] = useState(null)
  const [isFocused, setIsFocused] = useState(false)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)

  const prompt = useMemo(() => {
    const branchLabel = branchName ? `(${branchName})` : ''
    return `${PROMPT_USER}${branchLabel}:${cwdPath} $`
  }, [branchName, cwdPath])

  useEffect(() => {
    let cancelled = false
    const updateBranch = async () => {
      const root = await findGitRoot(cwdPath, statPath)
      if (!root) {
        if (!cancelled) {
          setBranchName(null)
        }
        return
      }
      const gitdir = `${root === '/' ? '' : root}/.git`
      try {
        const branch = await git.currentBranch({
          fs,
          dir: root,
          gitdir,
          fullname: false,
        })
        if (!cancelled) {
          setBranchName(branch || 'detached')
        }
      } catch (error) {
        if (!cancelled) {
          setBranchName(null)
        }
      }
    }
    updateBranch()
    return () => {
      cancelled = true
    }
  }, [cwdPath, fs, statPath, gitInitialized, resetToken])
  const commands = useMemo(() => createCommands(), [])

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [lines])

  const appendOutput = (outputLines) => {
    const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')
    setLines((prev) => [
      ...prev,
      ...outputLines.map((text) => ({ type: 'output', text: stripAnsi(text) })),
    ])
  }

  const getLineClass = (text) => {
    if (text.startsWith('@@')) {
      return 'terminal-pane__line terminal-pane__line--hunk'
    }
    if (text.startsWith('+++') || text.startsWith('---')) {
      return 'terminal-pane__line terminal-pane__line--header'
    }
    if (text.startsWith('+ ') && !text.startsWith('+++')) {
      return 'terminal-pane__line terminal-pane__line--add'
    }
    if (text.startsWith('- ') && !text.startsWith('---')) {
      return 'terminal-pane__line terminal-pane__line--del'
    }
    return 'terminal-pane__line'
  }

  const handleCommand = async (rawInput) => {
    const trimmed = rawInput.trim()
    if (!trimmed) {
      return
    }
    const [command, ...args] = trimmed.split(' ')
    const handler = commands[command]
    if (!handler) {
      appendOutput([`${command}: command not found`])
      return
    }
    await handler(args, {
      fs,
      cwdPath,
      statPath,
      readDirectory,
      readTextFile,
      createFile,
      createFolder,
      deleteNode,
      refreshTree,
      appendOutput,
      setLines,
      setCwdPath,
      setGitInitialized,
      setGitRoot,
      gitInitialized,
      gitRoot,
      setBranchName,
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const current = input
    const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')
    setLines((prev) => [
      ...prev,
      { type: 'input', text: stripAnsi(`${prompt} ${current}`) },
    ])
    if (current.trim()) {
      setHistory((prev) => [...prev, current])
    }
    setHistoryIndex(-1)
    setInput('')
    await handleCommand(current)
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
    <div
      className="terminal-pane"
      data-cy="terminal"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="terminal-pane__header">Terminal</div>
      <div className="terminal-pane__body" ref={bodyRef} data-cy="terminal-body">
        {lines.map((line, index) => (
          <div
            className={getLineClass(line.text)}
            data-cy="terminal-line"
            data-line-type={line.type}
            key={`${line.type}-${index}`}
          >
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
              data-cy="terminal-input"
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
