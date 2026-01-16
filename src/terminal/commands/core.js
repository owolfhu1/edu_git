import { ensureDirPath, normalizePath, splitPath } from '../utils'

const coreCommands = {
  help: async (_args, { appendOutput }) => {
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
  },
  pwd: async (_args, { cwdPath, appendOutput }) => {
    appendOutput([cwdPath])
  },
  ls: async (args, { cwdPath, readDirectory, appendOutput }) => {
    const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al')
    const targetArg = args.find((arg) => !arg.startsWith('-'))
    const targetPath = normalizePath(targetArg || '.', cwdPath)
    const entries = await readDirectory(targetPath)
    if (!entries) {
      appendOutput([`ls: cannot access '${targetArg || '.'}': No such directory`])
      return
    }
    const visibleEntries = showAll
      ? entries
      : entries.filter((entry) => !entry.startsWith('.') || entry === '.gitignore')
    const listing = visibleEntries.join('  ')
    appendOutput([listing || ''])
  },
  cd: async (args, { cwdPath, statPath, setCwdPath, appendOutput }) => {
    const targetPath = normalizePath(args[0] || '/', cwdPath)
    const stats = await statPath(targetPath)
    if (!stats || stats.type !== 'dir') {
      appendOutput([`cd: ${args[0] || '/'}: No such directory`])
      return
    }
    setCwdPath(targetPath)
  },
  cat: async (args, { cwdPath, readTextFile, appendOutput }) => {
    const targetPath = normalizePath(args[0], cwdPath)
    const content = await readTextFile(targetPath)
    if (content === null) {
      appendOutput([`cat: ${args[0]}: No such file`])
      return
    }
    const contentLines = content ? content.split('\n') : ['']
    appendOutput(contentLines)
  },
  touch: async (args, { cwdPath, statPath, createFile, appendOutput }) => {
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
  },
  mkdir: async (args, { cwdPath, statPath, createFolder, appendOutput }) => {
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
  },
  rm: async (args, { cwdPath, statPath, deleteNode, appendOutput }) => {
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
  },
  rmdir: async (args, { cwdPath, statPath, readDirectory, deleteNode, appendOutput }) => {
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
  },
  clear: async (_args, { setLines }) => {
    setLines([])
  },
}

export default coreCommands
