import git from 'isomorphic-git'
import { lcsDiff } from '../../git/diff'
import { findGitRoot } from '../../git/paths'
import { readBlobAtPath, readTreeContent } from '../../git/read'
import { getRelativePath, normalizePath, toAbsolutePath } from '../utils'

const gitCommand = async (args, context) => {
  const {
    fs,
    cwdPath,
    statPath,
    readTextFile,
    refreshTree,
    appendOutput,
    setGitInitialized,
    setGitRoot,
    setBranchName,
  } = context
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
      setBranchName('main')
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
      setBranchName(branch || 'detached')
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
    let message = messageIndex !== -1 ? args.slice(messageIndex + 1).join(' ') : ''
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
    if (!name.startsWith('-')) {
      const current = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
      setBranchName(current || 'detached')
    }
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
    const target = flagIndex !== -1 ? args[flagIndex + 1] : args[1] || args[0]
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
    const current = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
    setBranchName(current || 'detached')
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
}

export default gitCommand
