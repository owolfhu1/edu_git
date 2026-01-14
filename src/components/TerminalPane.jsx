import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import git from 'isomorphic-git'
import './TerminalPane.css'
import { FileSystemContext } from '../store/FileSystemContext'

const PROMPT_USER = 'edu-git@mock'

const getRelativePath = (root, absolutePath) => {
  if (!absolutePath.startsWith(root)) {
    return absolutePath.replace(/^\//, '')
  }
  const rel = absolutePath.slice(root.length)
  return rel.replace(/^\/+/, '')
}

const findGitRoot = async (cwdPath, statPath) => {
  let current = cwdPath
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

const ensureDirPath = (path) => (path === '' ? '/' : path)

const toAbsolutePath = (root, filepath) =>
  root === '/' ? `/${filepath}` : `${root}/${filepath}`

const decodeContent = (content) => {
  if (!content) {
    return ''
  }
  if (typeof content === 'string') {
    return content
  }
  return new TextDecoder().decode(content)
}

const normalizeGitPath = (path) => path.replace(/^\/+/, '')

const readTreeContent = async (fs, root, gitdir, tree, targetPath) => {
  const normalizedTarget = normalizeGitPath(targetPath)
  let content = null
  await git.walk({
    fs,
    dir: root,
    gitdir,
    trees: [tree],
    map: async (filepath, [entry]) => {
      const normalizedPath = normalizeGitPath(filepath)
      if (normalizedPath !== normalizedTarget) {
        return null
      }
      if (entry) {
        content = await entry.content()
      }
      return null
    },
  })
  return decodeContent(content)
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

const lcsDiff = (oldText, newText, file) => {
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

  const ops = []
  let i = rows
  let j = cols
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', line: oldLines[i - 1] })
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: 'del', line: oldLines[i - 1] })
      i -= 1
    } else {
      ops.push({ type: 'add', line: newLines[j - 1] })
      j -= 1
    }
  }
  while (i > 0) {
    ops.push({ type: 'del', line: oldLines[i - 1] })
    i -= 1
  }
  while (j > 0) {
    ops.push({ type: 'add', line: newLines[j - 1] })
    j -= 1
  }
  ops.reverse()

  const lines = [`diff -- ${file}`, `--- a/${file}`, `+++ b/${file}`]
  const context = 2
  let oldLine = 1
  let newLine = 1
  let hunk = null

  const pushHunkHeader = () => {
    if (!hunk) {
      return
    }
    const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    lines.push(header, ...hunk.lines)
    hunk = null
  }

  ops.forEach((op, index) => {
    const isChange = op.type !== 'equal'
    const shouldInclude =
      isChange ||
      (op.type === 'equal' &&
        ops.slice(Math.max(0, index - context), index + context + 1).some((item) => item.type !== 'equal'))

    if (shouldInclude) {
      if (!hunk) {
        hunk = {
          oldStart: oldLine,
          newStart: newLine,
          oldCount: 0,
          newCount: 0,
          lines: [],
        }
      }
      if (op.type === 'equal') {
        hunk.lines.push(`  ${op.line}`)
        hunk.oldCount += 1
        hunk.newCount += 1
      }
      if (op.type === 'del') {
        hunk.lines.push(`- ${op.line}`)
        hunk.oldCount += 1
      }
      if (op.type === 'add') {
        hunk.lines.push(`+ ${op.line}`)
        hunk.newCount += 1
      }
    } else if (hunk) {
      pushHunkHeader()
    }

    if (op.type === 'equal') {
      oldLine += 1
      newLine += 1
    } else if (op.type === 'del') {
      oldLine += 1
    } else if (op.type === 'add') {
      newLine += 1
    }
  })

  if (hunk) {
    pushHunkHeader()
  }

  return lines
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
  const {
    fs,
    createFile,
    createFolder,
    deleteNode,
    readDirectory,
    readTextFile,
    statPath,
    refreshTree,
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
        '  rm [-r] <path>   Remove a file or folder',
        '  rmdir <folder>   Remove an empty folder',
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
      const entries = await readDirectory(targetPath)
      if (!entries) {
        appendOutput([`ls: cannot access '${args[0] || '.'}': No such directory`])
        return
      }
      const listing = entries.join('  ')
      appendOutput([listing || ''])
      return
    }

    if (command === 'cd') {
      const targetPath = normalizePath(args[0] || '/', cwdPath)
      const stats = await statPath(targetPath)
      if (!stats || stats.type !== 'dir') {
        appendOutput([`cd: ${args[0] || '/'}: No such directory`])
        return
      }
      setCwdPath(targetPath)
      return
    }

    if (command === 'cat') {
      const targetPath = normalizePath(args[0], cwdPath)
      const content = await readTextFile(targetPath)
      if (content === null) {
        appendOutput([`cat: ${args[0]}: No such file`])
        return
      }
      const contentLines = content ? content.split('\n') : ['']
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
      const stats = await statPath(dirPath)
      if (!stats || stats.type !== 'dir') {
        appendOutput([`touch: cannot create file in '${dirPath}'`])
        return
      }
      const created = await createFile({
        parentId: dirPath === '/' ? null : ensureDirPath(dirPath),
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
      const stats = await statPath(dirPath)
      if (!stats || stats.type !== 'dir') {
        appendOutput([`mkdir: cannot create directory '${dirPath}'`])
        return
      }
      const created = await createFolder({
        parentId: dirPath === '/' ? null : ensureDirPath(dirPath),
        name,
      })
      if (!created) {
        appendOutput([`mkdir: cannot create directory '${name}': File exists`])
      }
      return
    }

    if (command === 'rm') {
      const flags = args.filter((arg) => arg.startsWith('-'))
      const recursive = flags.includes('-r') || flags.includes('-rf') || flags.includes('-fr')
      const targets = args.filter((arg) => !arg.startsWith('-'))
      if (targets.length === 0) {
        appendOutput(['rm: missing operand'])
        return
      }
      for (const targetArg of targets) {
        const targetPath = normalizePath(targetArg, cwdPath)
        const stats = await statPath(targetPath)
        if (!stats) {
          appendOutput([`rm: cannot remove '${targetArg}': No such file or directory`])
          continue
        }
        if (stats.type === 'dir' && !recursive) {
          appendOutput([`rm: cannot remove '${targetArg}': Is a directory`])
          continue
        }
        await deleteNode(targetPath)
      }
      return
    }

    if (command === 'rmdir') {
      if (args.length === 0) {
        appendOutput(['rmdir: missing operand'])
        return
      }
      for (const targetArg of args) {
        const targetPath = normalizePath(targetArg, cwdPath)
        const stats = await statPath(targetPath)
        if (!stats) {
          appendOutput([`rmdir: failed to remove '${targetArg}': No such directory`])
          continue
        }
        if (stats.type !== 'dir') {
          appendOutput([`rmdir: failed to remove '${targetArg}': Not a directory`])
          continue
        }
        const entries = await readDirectory(targetPath)
        if (entries && entries.length > 0) {
          appendOutput([`rmdir: failed to remove '${targetArg}': Directory not empty`])
          continue
        }
        await deleteNode(targetPath)
      }
      return
    }

    if (command === 'clear') {
      setLines([])
      return
    }

    if (command === 'git') {
      const subcommand = args[0]
      const resolveRepo = async () => {
        const root = await findGitRoot(cwdPath, statPath)
        if (!root) {
          appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
          return null
        }
        const gitdir = `${root === '/' ? '' : root}/.git`
        return { root, gitdir }
      }
      if (subcommand === 'init') {
        try {
          const gitdir = `${cwdPath === '/' ? '' : cwdPath}/.git`
          await git.init({ fs, dir: cwdPath, gitdir, defaultBranch: 'main' })
          setGitInitialized(true)
          setGitRoot(cwdPath)
          appendOutput([`Initialized empty Git repository in ${gitdir}/`])
          const created = await statPath(gitdir || '/.git')
          if (!created) {
            appendOutput(['warning: .git directory not created'])
          }
        } catch (error) {
          appendOutput([`fatal: ${error.message}`])
        }
        return
      }
      if (subcommand === 'status') {
        try {
          const repo = await resolveRepo()
          if (!repo) {
            return
          }
          const { root, gitdir } = repo
          const branch = await git.currentBranch({
            fs,
            dir: root,
            gitdir,
            fullname: false,
          })
          const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
          appendOutput([`On branch ${branch || 'main'}`])

          const staged = []
          const unstaged = []
          const untracked = []

          statusMatrix.forEach(([filepath, head, workdir, stage]) => {
            const isUntracked = head === 0 && workdir === 2 && stage === 0
            if (isUntracked) {
              untracked.push(filepath)
              return
            }
            if (stage !== head) {
              staged.push({ filepath, isNew: head === 0 })
            }
            if (workdir !== stage) {
              unstaged.push(filepath)
            }
          })

          if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
            appendOutput(['nothing to commit, working tree clean'])
            return
          }
          if (staged.length > 0) {
            appendOutput(['\x1b[33mChanges to be committed:\x1b[0m'])
            staged.forEach((item) =>
              appendOutput([`  ${item.isNew ? 'new file' : 'modified'}: ${item.filepath}`])
            )
          }
          if (unstaged.length > 0) {
            appendOutput(['\x1b[31mChanges not staged for commit:\x1b[0m'])
            unstaged.forEach((file) => appendOutput([`  modified: ${file}`]))
          }
          if (untracked.length > 0) {
            appendOutput(['\x1b[31mUntracked files:\x1b[0m'])
            untracked.forEach((file) => appendOutput([`  ${file}`]))
          }
        } catch (error) {
          appendOutput([`fatal: ${error.message || 'not a git repository'}`])
        }
        return
      }
      if (subcommand === 'diff') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const stagedOnly = args.includes('--staged') || args.includes('--cached')
        const targets = args.filter((arg) => !arg.startsWith('-') && arg !== 'diff')
        const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
        const changed = statusMatrix
          .filter(([filepath, head, workdir, stage]) =>
            stagedOnly ? stage !== head : workdir !== stage
          )
          .map(([filepath]) => filepath)
        const files = targets.length
          ? targets.map((target) => getRelativePath(root, normalizePath(target, cwdPath)))
          : changed
        if (files.length === 0) {
          appendOutput([''])
          return
        }
        for (const file of files) {
          let oldText = ''
          let newText = ''
          if (stagedOnly) {
            oldText = await readBlobAtPath(fs, root, gitdir, 'HEAD', file)
            newText = await readTreeContent(fs, root, gitdir, git.STAGE(), file)
          } else {
            oldText = await readBlobAtPath(fs, root, gitdir, 'HEAD', file)
            const absPath = toAbsolutePath(root, file)
            newText = (await readTextFile(absPath)) || ''
          }
          const diffLines = lcsDiff(oldText, newText, file)
          if (diffLines.length > 3) {
            appendOutput(diffLines)
          }
        }
        return
      }
      if (subcommand === 'add') {
        const target = args[1]
        if (!target) {
          appendOutput(['fatal: pathspec missing'])
          return
        }
        try {
          const root = await findGitRoot(cwdPath, statPath)
          if (!root) {
            appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
            return
          }
          const gitdir = `${root === '/' ? '' : root}/.git`
          if (target === '.') {
            const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
            for (const [filepath] of statusMatrix) {
              if (filepath.startsWith('.git')) {
                continue
              }
              await git.add({ fs, dir: root, gitdir, filepath })
            }
          } else {
            const absTarget = normalizePath(target, cwdPath)
            const relativeTarget = getRelativePath(root, absTarget)
            await git.add({ fs, dir: root, gitdir, filepath: relativeTarget })
          }
        } catch (error) {
          appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
        }
        return
      }
      if (subcommand === 'commit') {
        const messageIndex = args.findIndex((arg) => arg === '-m')
        let message =
          messageIndex !== -1 ? args.slice(messageIndex + 1).join(' ') : ''
        message = message.trim()
        if (
          (message.startsWith('"') && message.endsWith('"')) ||
          (message.startsWith("'") && message.endsWith("'"))
        ) {
          message = message.slice(1, -1)
        }
        if (!message) {
          appendOutput(['fatal: commit message required (use -m)'])
          return
        }
        try {
          const repo = await resolveRepo()
          if (!repo) {
            return
          }
          const { root, gitdir } = repo
          const branch = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
          const sha = await git.commit({
            fs,
            dir: root,
            gitdir,
            author: { name: 'Learner', email: 'learner@example.com' },
            message,
          })
          appendOutput([`[${branch || 'main'} ${sha.slice(0, 7)}] ${message}`])
        } catch (error) {
          appendOutput([`fatal: ${error.message}`])
        }
        return
      }
      if (subcommand === 'branch') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const flag = args[1]
        const name = args[1] && !args[1].startsWith('-') ? args[1] : args[2]
        if (!name) {
          const branches = await git.listBranches({ fs, dir: root, gitdir })
          const current = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
          const lines = branches.map((branch) =>
            branch === current ? `* ${branch}` : `  ${branch}`
          )
          appendOutput(lines.length ? lines : [''])
          return
        }
        if (flag === '-d') {
          await git.deleteBranch({ fs, dir: root, gitdir, ref: name })
          return
        }
        await git.branch({ fs, dir: root, gitdir, ref: name })
        return
      }
      if (subcommand === 'switch' || subcommand === 'checkout') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const createFlag = subcommand === 'switch' ? '-c' : '-b'
        const flagIndex = args.findIndex((arg) => arg === createFlag)
        const target =
          flagIndex !== -1 ? args[flagIndex + 1] : args[1] || args[0]
        if (!target) {
          appendOutput([`fatal: ${subcommand} requires a branch name`])
          return
        }
        if (flagIndex !== -1) {
          await git.branch({ fs, dir: root, gitdir, ref: target })
        }
        if (args[1] === '--' && args[2]) {
          const absPath = normalizePath(args[2], cwdPath)
          const relative = getRelativePath(root, absPath)
          await git.checkout({
            fs,
            dir: root,
            gitdir,
            ref: 'HEAD',
            filepaths: [relative],
            force: true,
            noUpdateHead: true,
          })
        } else {
          await git.checkout({ fs, dir: root, gitdir, ref: target, force: false })
        }
        await refreshTree()
        return
      }
      if (subcommand === 'restore') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const staged = args.includes('--staged')
        const target = args.find((arg) => !arg.startsWith('-') && arg !== 'restore')
        if (!target) {
          appendOutput(['fatal: restore requires a path'])
          return
        }
        const absPath = normalizePath(target, cwdPath)
        const relative = getRelativePath(root, absPath)
        if (staged) {
          await git.resetIndex({ fs, dir: root, gitdir, filepath: relative })
        } else {
          await git.checkout({
            fs,
            dir: root,
            gitdir,
            ref: 'HEAD',
            filepaths: [relative],
            force: true,
            noUpdateHead: true,
          })
          await refreshTree()
        }
        return
      }
      if (subcommand === 'reset') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const hardIndex = args.findIndex((arg) => arg === '--hard')
        if (hardIndex !== -1) {
          const ref = args[hardIndex + 1] || 'HEAD'
          await git.checkout({ fs, dir: root, gitdir, ref, force: true })
          await refreshTree()
          return
        }
        if (args[1] === 'HEAD' && args[2]) {
          const absPath = normalizePath(args[2], cwdPath)
          const relative = getRelativePath(root, absPath)
          await git.resetIndex({ fs, dir: root, gitdir, filepath: relative })
          return
        }
      }
      if (subcommand === 'rm') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const target = args[1]
        if (!target) {
          appendOutput(['fatal: rm requires a path'])
          return
        }
        const absPath = normalizePath(target, cwdPath)
        const relative = getRelativePath(root, absPath)
        await git.remove({ fs, dir: root, gitdir, filepath: relative })
        await refreshTree()
        return
      }
      if (subcommand === 'mv') {
        const repo = await resolveRepo()
        if (!repo) {
          return
        }
        const { root, gitdir } = repo
        const source = args[1]
        const destination = args[2]
        if (!source || !destination) {
          appendOutput(['fatal: mv requires source and destination'])
          return
        }
        const absSource = normalizePath(source, cwdPath)
        const absDestination = normalizePath(destination, cwdPath)
        await fs.promises.rename(absSource, absDestination)
        const sourceRel = getRelativePath(root, absSource)
        const destRel = getRelativePath(root, absDestination)
        await git.remove({ fs, dir: root, gitdir, filepath: sourceRel })
        await git.add({ fs, dir: root, gitdir, filepath: destRel })
        await refreshTree()
        return
      }
      if (subcommand === 'log') {
        try {
          const root = await findGitRoot(cwdPath, statPath)
          if (!root) {
            appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
            return
          }
          const gitdir = `${root === '/' ? '' : root}/.git`
          const commits = await git.log({ fs, dir: root, gitdir })
          const lines = commits.map((commit) => {
            const message = commit.commit.message.split('\n')[0]
            return `${commit.oid.slice(0, 7)} ${message}`
          })
          appendOutput(lines.length ? lines : [''])
        } catch (error) {
          appendOutput([`fatal: ${error.message}`])
        }
        return
      }
      if (subcommand === 'debug') {
        const candidate = `${cwdPath === '/' ? '' : cwdPath}/.git`
        const stats = await statPath(candidate || '/.git')
        let gitEntries = []
        try {
          gitEntries = (await fs.promises.readdir(candidate || '/.git')) || []
        } catch (error) {
          gitEntries = [`error: ${error.message}`]
        }
        appendOutput([
          `cwd: ${cwdPath}`,
          `gitdir: ${candidate || '/.git'}`,
          `gitdir exists: ${stats ? 'yes' : 'no'}`,
          `gitdir entries: ${gitEntries.join(', ') || '(empty)'}`,
          `fs.readFile: ${typeof fs.readFile}`,
          `fs.promises.readFile: ${typeof fs.promises?.readFile}`,
        ])
        return
      }
      appendOutput([`git: unknown command ${subcommand || ''}`])
      return
    }

    appendOutput([`${command}: command not found`])
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
    <div className="terminal-pane" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-pane__header">Terminal</div>
      <div className="terminal-pane__body" ref={bodyRef}>
        {lines.map((line, index) => (
          <div className={getLineClass(line.text)} key={`${line.type}-${index}`}>
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
