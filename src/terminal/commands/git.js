import git from 'isomorphic-git'
import diff3Merge from 'diff3'
import { lcsDiff } from '../../git/diff'
import { findGitRoot } from '../../git/paths'
import { readBlobAtPath, readTreeContent } from '../../git/read'
import { getRelativePath, normalizePath, toAbsolutePath } from '../utils'

const REMOTE_ROOT = '/.remotes'

const ensureDir = async (pfs, path) => {
  try {
    await pfs.mkdir(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }
}

const ensureRemoteRepo = async (fs, pfs, remoteName) => {
  await ensureDir(pfs, REMOTE_ROOT)
  const remotePath = `${REMOTE_ROOT}/${remoteName}`
  await ensureDir(pfs, remotePath)
  const gitdir = `${remotePath}/.git`
  try {
    await pfs.stat(gitdir)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    await git.init({ fs, dir: remotePath, gitdir, defaultBranch: 'main' })
  }
  return { remotePath, gitdir }
}

const copyDir = async (pfs, source, destination) => {
  try {
    await ensureDir(pfs, destination)
    const entries = await pfs.readdir(source)
    for (const entry of entries) {
      const fromPath = `${source}/${entry}`
      const toPath = `${destination}/${entry}`
      const stats = await pfs.stat(fromPath)
      if (stats.type === 'dir') {
        await copyDir(pfs, fromPath, toPath)
      } else {
        const content = await pfs.readFile(fromPath)
        await pfs.writeFile(toPath, content)
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

const readBlobByOid = async (fs, dir, gitdir, oid) => {
  if (!oid) {
    return ''
  }
  const { blob } = await git.readBlob({ fs, dir, gitdir, oid })
  return new TextDecoder().decode(blob)
}

const buildBlobIndex = async (fs, dir, gitdir, oid) => {
  if (!oid) {
    return new Map()
  }
  const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
  const index = new Map()

  const walk = async (tree, prefix) => {
    for (const entry of tree) {
      const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'blob') {
        index.set(entryPath, entry.oid)
      } else if (entry.type === 'tree') {
        const { tree: subtree } = await git.readTree({
          fs,
          dir,
          gitdir,
          oid: entry.oid,
        })
        await walk(subtree, entryPath)
      }
    }
  }

  const { tree } = await git.readTree({ fs, dir, gitdir, oid: commit.tree })
  await walk(tree, '')
  return index
}

const resolveCommitish = async (fs, dir, gitdir, ref) => {
  if (ref === 'HEAD') {
    return git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' })
  }
  if (!ref.includes('~') && !ref.includes('^')) {
    return git.resolveRef({ fs, dir, gitdir, ref })
  }
  const caretSplit = ref.split('^')
  const parts = caretSplit[0].split('~')
  let base = parts[0] || 'HEAD'
  let oid = await git.resolveRef({ fs, dir, gitdir, ref: base })
  if (parts.length > 1) {
    const count = parts[1] === '' ? 1 : Number(parts[1])
    if (Number.isNaN(count) || count < 0) {
      throw new Error(`invalid ref: ${ref}`)
    }
    for (let index = 0; index < count; index += 1) {
      const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
      if (!commit.parent?.length) {
        throw new Error(`invalid ref: ${ref}`)
      }
      oid = commit.parent[0]
    }
  }
  if (ref.includes('^')) {
    const caretMatch = ref.match(/\^(\d+)?$/)
    const parentIndex = caretMatch?.[1] ? Number(caretMatch[1]) - 1 : 0
    const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
    if (!commit.parent?.[parentIndex]) {
      throw new Error(`invalid ref: ${ref}`)
    }
    oid = commit.parent[parentIndex]
  }
  return oid
}

const LINEBREAKS = /^.*(\r?\n|$)/gm

const mergeFileContents = (baseText, headText, targetText, headLabel, targetLabel) => {
  const baseLines = (baseText ?? '').match(LINEBREAKS) || ['']
  const headLines = (headText ?? '').match(LINEBREAKS) || ['']
  const targetLines = (targetText ?? '').match(LINEBREAKS) || ['']
  const result = diff3Merge(headLines, baseLines, targetLines)
  let mergedText = ''
  let cleanMerge = true

  result.forEach((item) => {
    if (item.ok) {
      mergedText += item.ok.join('')
    }
    if (item.conflict) {
      cleanMerge = false
      mergedText += `<<<<<<< ${headLabel}\n`
      mergedText += item.conflict.a.join('')
      mergedText += '=======\n'
      mergedText += item.conflict.b.join('')
      mergedText += `>>>>>>> ${targetLabel}\n`
    }
  })

  return { cleanMerge, mergedText }
}

const applyCommitChanges = async ({ fs, pfs, root, gitdir, commitOid, headOid }) => {
  const { commit } = await git.readCommit({ fs, dir: root, gitdir, oid: commitOid })
  const parentOid = commit.parent?.[0] || null
  const parentIndex = await buildBlobIndex(fs, root, gitdir, parentOid)
  const targetIndex = await buildBlobIndex(fs, root, gitdir, commitOid)
  const headIndex = await buildBlobIndex(fs, root, gitdir, headOid)
  const paths = new Set([
    ...parentIndex.keys(),
    ...targetIndex.keys(),
    ...headIndex.keys(),
  ])
  const conflictFiles = []
  const changedFiles = []
  const headLabel = 'HEAD'
  const targetLabel = commitOid.slice(0, 7)
  for (const path of paths) {
    const parentBlob = parentIndex.get(path) || null
    const targetBlob = targetIndex.get(path) || null
    if (parentBlob === targetBlob) {
      continue
    }
    const headBlob = headIndex.get(path) || null
    if (headBlob === targetBlob) {
      continue
    }
    if (!targetBlob) {
      if (headBlob && headBlob !== parentBlob) {
        conflictFiles.push(path)
        const headText = await readBlobByOid(fs, root, gitdir, headBlob)
        const { mergedText } = mergeFileContents(
          await readBlobByOid(fs, root, gitdir, parentBlob),
          headText,
          '',
          headLabel,
          targetLabel
        )
        await pfs.writeFile(`${root}/${path}`, mergedText)
        continue
      }
      try {
        await pfs.unlink(`${root}/${path}`)
      } catch (error) {
        // ignore missing files
      }
      await git.remove({ fs, dir: root, gitdir, filepath: path })
      changedFiles.push(path)
      continue
    }
    const baseText = await readBlobByOid(fs, root, gitdir, parentBlob)
    const headText = await readBlobByOid(fs, root, gitdir, headBlob)
    const targetText = await readBlobByOid(fs, root, gitdir, targetBlob)
    const { cleanMerge, mergedText } = mergeFileContents(
      baseText,
      headText,
      targetText,
      headLabel,
      targetLabel
    )
    if (!cleanMerge) {
      conflictFiles.push(path)
      await pfs.writeFile(`${root}/${path}`, mergedText)
      continue
    }
    if (mergedText === headText) {
      continue
    }
    await pfs.writeFile(`${root}/${path}`, mergedText)
    await git.add({ fs, dir: root, gitdir, filepath: path })
    changedFiles.push(path)
  }
  return {
    conflictFiles,
    changedFiles,
    commitMessage: commit.message,
    debugInfo: {
      parentCount: parentIndex.size,
      targetCount: targetIndex.size,
      headCount: headIndex.size,
      pathsCount: paths.size,
    },
  }
}

const hasUnresolvedConflicts = async (fs, dir, gitdir, files) => {
  const statusMatrix = await git.statusMatrix({ fs, dir, gitdir })
  const conflictSet = new Set(files)
  return statusMatrix.some(([filepath, head, workdir, stage]) => {
    if (!conflictSet.has(filepath)) {
      return false
    }
    if (stage === 3) {
      return true
    }
    return workdir !== stage
  })
}

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
  const pfs = fs.promises
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
      let mergeHead = null
      let rebaseHead = null
      try {
        mergeHead = (await pfs.readFile(`${gitdir}/MERGE_HEAD`, 'utf8')).trim()
      } catch (error) {
        mergeHead = null
      }
      try {
        rebaseHead = (await pfs.readFile(`${gitdir}/REBASE_HEAD`, 'utf8')).trim()
      } catch (error) {
        rebaseHead = null
      }
      if (branch) {
        appendOutput([`On branch ${branch}`])
      } else {
        const headOid = await git.resolveRef({ fs, dir: root, gitdir, ref: 'HEAD' })
        appendOutput([`HEAD detached at ${headOid.slice(0, 7)}`])
      }

      const staged = []
      const unstaged = []
      const untracked = []
      const conflicted = []

      statusMatrix.forEach(([filepath, head, workdir, stage]) => {
        if (filepath.startsWith('.remotes/')) {
          return
        }
        if (stage === 3) {
          conflicted.push(filepath)
          return
        }
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
      if (mergeHead) {
        appendOutput(['\x1b[31mYou are in the middle of a merge.\x1b[0m'])
      }
      if (rebaseHead) {
        appendOutput(['\x1b[31mYou are in the middle of a rebase.\x1b[0m'])
      }
      if (conflicted.length > 0) {
        appendOutput(['\x1b[31mUnmerged paths:\x1b[0m'])
        conflicted.forEach((file) => appendOutput([`  both modified: ${file}`]))
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
          if (
            filepath.startsWith('.git') ||
            filepath.startsWith('.remotes/') ||
            filepath === '.edu_git_remote.json'
          ) {
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
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      let mergeHead = null
      try {
        mergeHead = (await pfs.readFile(`${gitdir}/MERGE_HEAD`, 'utf8')).trim()
      } catch (error) {
        mergeHead = null
      }
      const messageIndex = args.findIndex((arg) => arg === '-m')
      let message = messageIndex !== -1 ? args.slice(messageIndex + 1).join(' ') : ''
      message = message.trim()
      if (
        (message.startsWith('"') && message.endsWith('"')) ||
        (message.startsWith("'") && message.endsWith("'"))
      ) {
        message = message.slice(1, -1)
      }
      if (!message && mergeHead) {
        try {
          message = (await pfs.readFile(`${gitdir}/MERGE_MSG`, 'utf8')).trim()
        } catch (error) {
          message = 'Merge commit'
        }
      }
      if (!message) {
        appendOutput(['fatal: commit message required (use -m)'])
        return
      }
      const branch = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
      let parents = undefined
      if (mergeHead) {
        const headOid = await git.resolveRef({
          fs,
          dir: root,
          gitdir,
          ref: branch || 'HEAD',
        })
        parents = [headOid, mergeHead]
      }
      const sha = await git.commit({
        fs,
        dir: root,
        gitdir,
        author: { name: 'Learner', email: 'learner@example.com' },
        message,
        parent: parents,
      })
      if (mergeHead) {
        try {
          await pfs.unlink(`${gitdir}/MERGE_HEAD`)
          await pfs.unlink(`${gitdir}/MERGE_MSG`)
        } catch (error) {
          // Ignore cleanup failures; merge commit is still created.
        }
      }
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
    const isRemoteOnly = flag === '-r'
    const isAll = flag === '-a'
    if (!name || isRemoteOnly || isAll) {
      const branches = await git.listBranches({ fs, dir: root, gitdir })
      const current = await git.currentBranch({ fs, dir: root, gitdir, fullname: false })
      const localLines = branches.map((branch) =>
        branch === current ? `* ${branch}` : `  ${branch}`
      )
      let remoteLines = []
      if (isRemoteOnly || isAll) {
        const remotes = await git.listRemotes({ fs, dir: root, gitdir })
        const remoteName = remotes[0]?.remote || 'origin'
        const remoteBranches = await git.listBranches({
          fs,
          dir: root,
          gitdir,
          remote: remoteName,
        })
        remoteLines = remoteBranches.map(
          (branch) => `  remotes/${remoteName}/${branch}`
        )
      }
      const lines = isRemoteOnly ? remoteLines : localLines.concat(remoteLines)
      appendOutput(lines.length ? lines : [''])
      return
    }
    if (flag === '-d' || flag === '-D') {
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
    try {
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
        let resolvedTarget = target
        const isCommitish =
          /^[0-9a-f]{4,40}$/i.test(target) ||
          target.includes('~') ||
          target.includes('^')
      if (isCommitish) {
        try {
          if (/^[0-9a-f]{4,39}$/i.test(target)) {
            resolvedTarget = await git.expandOid({ fs, dir: root, gitdir, oid: target })
          } else {
            resolvedTarget = await resolveCommitish(fs, root, gitdir, target)
          }
        } catch (error) {
          appendOutput([`fatal: reference is not a tree: ${target}`])
          return
        }
      }
        await git.checkout({
          fs,
          dir: root,
          gitdir,
          ref: resolvedTarget,
          force: isCommitish,
        })
      }
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
      return
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
      const currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      let targetOid = null
      try {
        if (
          ref === 'HEAD' ||
          ref.includes('~') ||
          ref.includes('^')
        ) {
          targetOid = await resolveCommitish(fs, root, gitdir, ref)
        } else if (/^[0-9a-f]{4,39}$/i.test(ref)) {
          targetOid = await git.expandOid({ fs, dir: root, gitdir, oid: ref })
        } else {
          try {
            targetOid = await git.resolveRef({ fs, dir: root, gitdir, ref })
          } catch (error) {
            try {
              targetOid = await git.resolveRef({
                fs,
                dir: root,
                gitdir,
                ref: `refs/remotes/${ref}`,
              })
            } catch (remoteError) {
              targetOid = await git.resolveRef({
                fs,
                dir: root,
                gitdir,
                ref: `refs/heads/${ref}`,
              })
            }
          }
        }
      } catch (error) {
        appendOutput([`fatal: ambiguous argument '${ref}': unknown revision`])
        return
      }
      if (currentBranch) {
        await git.writeRef({
          fs,
          dir: root,
          gitdir,
          ref: `refs/heads/${currentBranch}`,
          value: targetOid,
          force: true,
        })
        await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
        setBranchName(currentBranch)
      } else {
        await git.checkout({ fs, dir: root, gitdir, ref: targetOid, force: true })
        setBranchName('detached')
      }
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

  if (subcommand === 'remote') {
    const repo = await resolveRepo()
    if (!repo) {
      return
    }
    const { root, gitdir } = repo
    const action = args[1]
    if (!action) {
      const remotes = await git.listRemotes({ fs, dir: root, gitdir })
      appendOutput(remotes.length ? remotes.map((item) => item.remote) : [''])
      return
    }
    if (action === '-v') {
      const remotes = await git.listRemotes({ fs, dir: root, gitdir })
      const lines = remotes.flatMap((item) => [
        `${item.remote}\t${item.url} (fetch)`,
        `${item.remote}\t${item.url} (push)`,
      ])
      appendOutput(lines.length ? lines : [''])
      return
    }
    if (action === 'add') {
      const name = args[2]
      const url = args[3]
      if (!name || !url) {
        appendOutput(['fatal: remote add requires name and url'])
        return
      }
      await git.setConfig({ fs, dir: root, gitdir, path: `remote.${name}.url`, value: url })
      appendOutput([`Added remote ${name}`])
      return
    }
    appendOutput([`git: unknown remote command ${action}`])
    return
  }

  if (subcommand === 'push') {
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      const setUpstream = args.includes('-u') || args.includes('--set-upstream')
      const forcePush = args.includes('--force') || args.includes('--force-with-lease')
      const positional = args.slice(1).filter((arg) => !arg.startsWith('-'))
      const remoteName = setUpstream ? positional[0] : positional[0]
      const branchArg = setUpstream ? positional[1] : positional[1]
      const remote = remoteName || 'origin'
      const currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      const branch = branchArg || currentBranch
      if (!branch) {
        appendOutput(['fatal: push requires a branch name'])
        return
      }
      const url = await git.getConfig({
        fs,
        dir: root,
        gitdir,
        path: `remote.${remote}.url`,
      })
      if (!url) {
        appendOutput([`fatal: '${remote}' does not appear to be a git repository`])
        return
      }
      const localOid = await git.resolveRef({ fs, dir: root, gitdir, ref: branch })
      const remoteRepo = await ensureRemoteRepo(fs, pfs, remote)
      await copyDir(pfs, `${gitdir}/objects`, `${remoteRepo.gitdir}/objects`)
      await git.writeRef({
        fs,
        dir: remoteRepo.remotePath,
        gitdir: remoteRepo.gitdir,
        ref: `refs/heads/${branch}`,
        value: localOid,
        force: true,
      })
      appendOutput([`Pushed ${branch} to ${remote}${forcePush ? ' (forced)' : ''}`])
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
    }
    return
  }

  if (subcommand === 'fetch') {
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      const remote = args[1] || 'origin'
      const branchFilter = args[2]
      const url = await git.getConfig({
        fs,
        dir: root,
        gitdir,
        path: `remote.${remote}.url`,
      })
      if (!url) {
        appendOutput([`fatal: '${remote}' does not appear to be a git repository`])
        return
      }
      const remoteRepo = await ensureRemoteRepo(fs, pfs, remote)
      await copyDir(pfs, `${remoteRepo.gitdir}/objects`, `${gitdir}/objects`)
      const remoteBranches = await git.listBranches({
        fs,
        dir: remoteRepo.remotePath,
        gitdir: remoteRepo.gitdir,
      })
      const branches = branchFilter
        ? remoteBranches.filter((name) => name === branchFilter)
        : remoteBranches
      for (const branch of branches) {
        const remoteOid = await git.resolveRef({
          fs,
          dir: remoteRepo.remotePath,
          gitdir: remoteRepo.gitdir,
          ref: branch,
        })
        await git.writeRef({
          fs,
          dir: root,
          gitdir,
          ref: `refs/remotes/${remote}/${branch}`,
          value: remoteOid,
          force: true,
        })
      }
      appendOutput([`Fetched ${remote}`])
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
    }
    return
  }

  if (subcommand === 'pull') {
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      const remote = args[1] || 'origin'
      const currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      if (!currentBranch) {
        appendOutput(['fatal: pull requires a branch name'])
        return
      }
      const remoteBranch = args[2] || currentBranch
      const url = await git.getConfig({
        fs,
        dir: root,
        gitdir,
        path: `remote.${remote}.url`,
      })
      if (!url) {
        appendOutput([`fatal: '${remote}' does not appear to be a git repository`])
        return
      }
      const remoteRepo = await ensureRemoteRepo(fs, pfs, remote)
      await copyDir(pfs, `${remoteRepo.gitdir}/objects`, `${gitdir}/objects`)
      const remoteOid = await git.resolveRef({
        fs,
        dir: remoteRepo.remotePath,
        gitdir: remoteRepo.gitdir,
        ref: remoteBranch,
      })
      await git.writeRef({
        fs,
        dir: root,
        gitdir,
        ref: `refs/remotes/${remote}/${remoteBranch}`,
        value: remoteOid,
        force: true,
      })
      const localOid = await git.resolveRef({
        fs,
        dir: root,
        gitdir,
        ref: currentBranch,
      })
      if (remoteOid === localOid) {
        appendOutput(['Already up to date.'])
        return
      }
      const isFastForward = await git.isDescendent({
        fs,
        dir: root,
        gitdir,
        oid: remoteOid,
        ancestor: localOid,
      })
      if (isFastForward) {
        await git.writeRef({
          fs,
          dir: root,
          gitdir,
          ref: `refs/heads/${currentBranch}`,
          value: remoteOid,
          force: true,
        })
        await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
        await refreshTree()
        appendOutput([`Updated ${currentBranch} from ${remote}/${remoteBranch}`])
        return
      }
      try {
        const result = await git.merge({
          fs,
          dir: root,
          gitdir,
          ours: currentBranch,
          theirs: `refs/remotes/${remote}/${remoteBranch}`,
          fastForward: true,
          fastForwardOnly: false,
          abortOnConflict: false,
          author: { name: 'Learner', email: 'learner@example.com' },
          committer: { name: 'Learner', email: 'learner@example.com' },
        })
        await refreshTree()
        if (result?.alreadyMerged) {
          appendOutput(['Already up to date.'])
          return
        }
        appendOutput([`Merged ${remote}/${remoteBranch} into ${currentBranch}`])
      } catch (error) {
        if (error?.code === 'MergeConflictError') {
          try {
            await pfs.writeFile(`${gitdir}/MERGE_HEAD`, `${remoteOid}\n`)
            await pfs.writeFile(
              `${gitdir}/MERGE_MSG`,
              `Merge ${remote}/${remoteBranch} into ${currentBranch}\n`
            )
          } catch (writeError) {
            // Ignore merge state write errors.
          }
          const conflictFiles = error.data?.filepaths || []
          for (const file of conflictFiles) {
            try {
              const content = await pfs.readFile(`${root}/${file}`, 'utf8')
              const normalized = content
                .replace(/([^\n])>>>>>>>/g, '$1\n>>>>>>>')
                .replace(/<<<<<<<\s*/g, '<<<<<<< ')
                .replace(/=======([^\n])/g, '=======\n$1')
                .replace(/=======$/g, '=======')
              const finalContent = normalized.endsWith('\n') ? normalized : `${normalized}\n`
              await pfs.writeFile(`${root}/${file}`, finalContent)
            } catch (readError) {
              // Ignore cleanup failures; keep original conflict markers.
            }
          }
          await refreshTree()
          appendOutput([
            'Automatic merge failed; fix conflicts and commit the result.',
            ...conflictFiles.map((file) => `CONFLICT (content): ${file}`),
          ])
          return
        }
        appendOutput([`fatal: ${error.message}`])
      }
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
    }
    return
  }

  if (subcommand === 'merge') {
    let root = null
    let gitdir = null
    let currentBranch = null
    let oursRef = null
    let theirsRef = null
    let theirsOid = null
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      root = repo.root
      gitdir = repo.gitdir
      currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      const target = args[1]
      if (target === '--abort') {
        try {
          await pfs.readFile(`${gitdir}/MERGE_HEAD`, 'utf8')
        } catch (error) {
          appendOutput(['fatal: There is no merge to abort (MERGE_HEAD missing).'])
          return
        }
        await pfs.unlink(`${gitdir}/MERGE_HEAD`).catch(() => {})
        await pfs.unlink(`${gitdir}/MERGE_MSG`).catch(() => {})
        if (currentBranch) {
          await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
          await refreshTree()
        }
        appendOutput(['Merge aborted.'])
        return
      }
      if (!target) {
        appendOutput(['fatal: merge requires a branch name'])
        return
      }
      oursRef = currentBranch || 'HEAD'
      theirsRef = target.startsWith('refs/')
        ? target
        : target.includes('/')
          ? `refs/remotes/${target}`
          : target
      try {
        theirsOid = await git.resolveRef({
          fs,
          dir: root,
          gitdir,
          ref: theirsRef,
        })
      } catch (error) {
        appendOutput([`fatal: '${target}' does not appear to be a git repository`])
        return
      }
      const result = await git.merge({
        fs,
        dir: root,
        gitdir,
        ours: oursRef,
        theirs: theirsRef,
        fastForward: true,
        fastForwardOnly: false,
        abortOnConflict: false,
        author: { name: 'Learner', email: 'learner@example.com' },
        committer: { name: 'Learner', email: 'learner@example.com' },
      })
      await refreshTree()
      if (result?.alreadyMerged) {
        appendOutput(['Already up to date.'])
        return
      }
      appendOutput([`Merged ${target} into ${currentBranch || 'HEAD'}`])
    } catch (error) {
      if (error?.code === 'MergeConflictError') {
        const conflictFiles = error.data?.filepaths || []
        try {
          if (gitdir && theirsOid) {
            await pfs.writeFile(`${gitdir}/MERGE_HEAD`, `${theirsOid}\n`)
            await pfs.writeFile(
              `${gitdir}/MERGE_MSG`,
              `Merge ${theirsRef || ''} into ${currentBranch || 'HEAD'}\n`
            )
          }
        } catch (writeError) {
          // Ignore merge state write errors.
        }
        for (const file of conflictFiles) {
          try {
            const content = await pfs.readFile(`${root}/${file}`, 'utf8')
            const normalized = content
              .replace(/([^\n])>>>>>>>/g, '$1\n>>>>>>>')
              .replace(/<<<<<<<\s*/g, '<<<<<<< ')
              .replace(/=======([^\n])/g, '=======\n$1')
              .replace(/=======$/g, '=======')
            const finalContent = normalized.endsWith('\n') ? normalized : `${normalized}\n`
            await pfs.writeFile(`${root}/${file}`, finalContent)
          } catch (readError) {
            // Ignore cleanup failures; keep original conflict markers.
          }
        }
        await refreshTree()
        appendOutput([
          'Automatic merge failed; fix conflicts and commit the result.',
          ...conflictFiles.map((file) => `CONFLICT (content): ${file}`),
        ])
        return
      }
      appendOutput([`fatal: ${error.message}`])
    }
    return
  }

  if (subcommand === 'rebase') {
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      const currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      const action = args[1]
      const rebaseHeadPath = `${gitdir}/REBASE_HEAD`
      const rebaseOrigPath = `${gitdir}/REBASE_ORIG_HEAD`
      const rebaseTodoPath = `${gitdir}/REBASE_TODO`
      const rebaseIndexPath = `${gitdir}/REBASE_INDEX`
      const rebaseCurrentPath = `${gitdir}/REBASE_CURRENT`
      const rebaseConflictsPath = `${gitdir}/REBASE_CONFLICTS`

      if (action === '--abort') {
        let origOid = null
        try {
          origOid = (await pfs.readFile(rebaseOrigPath, 'utf8')).trim()
        } catch (error) {
          appendOutput(['fatal: No rebase in progress.'])
          return
        }
        if (currentBranch && origOid) {
          await git.writeRef({
            fs,
            dir: root,
            gitdir,
            ref: `refs/heads/${currentBranch}`,
            value: origOid,
            force: true,
          })
          await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
          await refreshTree()
        }
        await Promise.all([
          pfs.unlink(rebaseHeadPath).catch(() => {}),
          pfs.unlink(rebaseOrigPath).catch(() => {}),
          pfs.unlink(rebaseTodoPath).catch(() => {}),
          pfs.unlink(rebaseIndexPath).catch(() => {}),
          pfs.unlink(rebaseCurrentPath).catch(() => {}),
          pfs.unlink(rebaseConflictsPath).catch(() => {}),
        ])
        appendOutput(['Rebase aborted.'])
        return
      }

      if (action === '--continue') {
        let todo = []
        let index = 0
        let currentOid = null
        let conflictFiles = []
        try {
          todo = JSON.parse(await pfs.readFile(rebaseTodoPath, 'utf8'))
          index = Number(await pfs.readFile(rebaseIndexPath, 'utf8'))
        } catch (error) {
          appendOutput(['fatal: No rebase in progress.'])
          return
        }
        try {
          currentOid = (await pfs.readFile(rebaseCurrentPath, 'utf8')).trim()
        } catch (error) {
          currentOid = null
        }
        try {
          conflictFiles = JSON.parse(await pfs.readFile(rebaseConflictsPath, 'utf8'))
        } catch (error) {
          conflictFiles = []
        }
        if (await hasUnresolvedConflicts(fs, root, gitdir, conflictFiles)) {
          appendOutput(['fatal: Fix conflicts and stage the result first.'])
          return
        }
        if (currentOid) {
          const { commit } = await git.readCommit({ fs, dir: root, gitdir, oid: currentOid })
          const sha = await git.commit({
            fs,
            dir: root,
            gitdir,
            author: { name: 'Learner', email: 'learner@example.com' },
            message: commit.message,
          })
          await pfs.unlink(rebaseCurrentPath).catch(() => {})
          await pfs.unlink(rebaseConflictsPath).catch(() => {})
          index += 1
          await pfs.writeFile(rebaseIndexPath, String(index))
          appendOutput([`[${currentBranch} ${sha.slice(0, 7)}] ${commit.message.split('\n')[0]}`])
        }
        for (let idx = index; idx < todo.length; idx += 1) {
          const commitOid = todo[idx]
          const headOid = await git.resolveRef({ fs, dir: root, gitdir, ref: currentBranch })
          const { conflictFiles: conflicts, changedFiles, commitMessage } =
            await applyCommitChanges({
              fs,
              pfs,
              root,
              gitdir,
              commitOid,
              headOid,
            })
          await refreshTree()
          if (conflicts.length > 0) {
            await pfs.writeFile(rebaseCurrentPath, `${commitOid}\n`).catch(() => {})
            await pfs.writeFile(rebaseConflictsPath, JSON.stringify(conflicts)).catch(() => {})
            await pfs.writeFile(rebaseIndexPath, String(idx)).catch(() => {})
            appendOutput([
              'Automatic rebase failed; fix conflicts and run "git rebase --continue".',
              ...conflicts.map((file) => `CONFLICT (content): ${file}`),
            ])
            return
          }
          if (changedFiles.length > 0) {
            const sha = await git.commit({
              fs,
              dir: root,
              gitdir,
              author: { name: 'Learner', email: 'learner@example.com' },
              message: commitMessage,
            })
            appendOutput([`[${currentBranch} ${sha.slice(0, 7)}] ${commitMessage.split('\n')[0]}`])
          }
          await pfs.writeFile(rebaseIndexPath, String(idx + 1))
        }
        await Promise.all([
          pfs.unlink(rebaseHeadPath).catch(() => {}),
          pfs.unlink(rebaseOrigPath).catch(() => {}),
          pfs.unlink(rebaseTodoPath).catch(() => {}),
          pfs.unlink(rebaseIndexPath).catch(() => {}),
          pfs.unlink(rebaseCurrentPath).catch(() => {}),
          pfs.unlink(rebaseConflictsPath).catch(() => {}),
        ])
        appendOutput([`Successfully rebased and updated ${currentBranch}.`])
        return
      }

      if (!action) {
        appendOutput(['fatal: rebase requires a branch name'])
        return
      }
      if (!currentBranch) {
        appendOutput(['fatal: rebase requires a current branch'])
        return
      }
      const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
      const hasChanges = statusMatrix.some(
        ([filepath, head, workdir, stage]) =>
          !filepath.startsWith('.remotes/') && (head !== workdir || head !== stage)
      )
      if (hasChanges) {
        appendOutput(['fatal: rebase requires a clean working tree.'])
        return
      }
      const upstreamRef = action.startsWith('refs/')
        ? action
        : action.includes('/')
          ? `refs/remotes/${action}`
          : action
      let upstreamOid = null
      try {
        upstreamOid = await git.resolveRef({
          fs,
          dir: root,
          gitdir,
          ref: upstreamRef,
        })
      } catch (error) {
        appendOutput([`fatal: invalid upstream '${action}'`])
        return
      }
      const headOid = await git.resolveRef({ fs, dir: root, gitdir, ref: currentBranch })
      const headDescendsUpstream = await git.isDescendent({
        fs,
        dir: root,
        gitdir,
        oid: headOid,
        ancestor: upstreamOid,
      })
      if (headDescendsUpstream) {
        appendOutput(['Current branch is up to date.'])
        return
      }
      const compareCommitsList = await git.log({ fs, dir: root, gitdir, ref: currentBranch })
      const baseCommitsList = await git.log({ fs, dir: root, gitdir, ref: upstreamRef })
      const baseOids = new Set(baseCommitsList.map((commit) => commit.oid))
      const uniqueCommits = compareCommitsList.filter(
        (commit) => !baseOids.has(commit.oid)
      )
      if (uniqueCommits.length === 0) {
        appendOutput(['Current branch is up to date.'])
        return
      }
      const todo = uniqueCommits.map((commit) => commit.oid).reverse()
      await pfs.writeFile(rebaseHeadPath, `${upstreamOid}\n`).catch(() => {})
      await pfs.writeFile(rebaseOrigPath, `${headOid}\n`).catch(() => {})
      await pfs.writeFile(rebaseTodoPath, JSON.stringify(todo)).catch(() => {})
      await pfs.writeFile(rebaseIndexPath, '0').catch(() => {})
      await git.writeRef({
        fs,
        dir: root,
        gitdir,
        ref: `refs/heads/${currentBranch}`,
        value: upstreamOid,
        force: true,
      })
      await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
      await refreshTree()
      appendOutput([`Rebasing ${currentBranch} onto ${action}`])
      await gitCommand(['rebase', '--continue'], context)
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
    }
    return
  }

  if (subcommand === 'cherry-pick') {
    try {
      const repo = await resolveRepo()
      if (!repo) {
        return
      }
      const { root, gitdir } = repo
      const action = args[1]
      const currentBranch = await git.currentBranch({
        fs,
        dir: root,
        gitdir,
        fullname: false,
      })
      if (action === '--continue') {
        let message = ''
        try {
          message = (await pfs.readFile(`${gitdir}/CHERRY_PICK_MSG`, 'utf8')).trim()
          await pfs.readFile(`${gitdir}/CHERRY_PICK_HEAD`, 'utf8')
        } catch (error) {
          appendOutput(['fatal: There is no cherry-pick in progress.'])
          return
        }
        const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
        const hasConflicts = statusMatrix.some(([, , , stage]) => stage === 3)
        if (hasConflicts) {
          appendOutput(['fatal: Fix conflicts and stage the result first.'])
          return
        }
        const sha = await git.commit({
          fs,
          dir: root,
          gitdir,
          author: { name: 'Learner', email: 'learner@example.com' },
          message: message || 'cherry-pick',
        })
        await pfs.unlink(`${gitdir}/CHERRY_PICK_HEAD`).catch(() => {})
        await pfs.unlink(`${gitdir}/CHERRY_PICK_MSG`).catch(() => {})
        appendOutput([`[${currentBranch || 'HEAD'} ${sha.slice(0, 7)}] ${message}`])
        return
      }
      if (action === '--abort') {
        try {
          await pfs.readFile(`${gitdir}/CHERRY_PICK_HEAD`, 'utf8')
        } catch (error) {
          appendOutput(['fatal: There is no cherry-pick in progress.'])
          return
        }
        await pfs.unlink(`${gitdir}/CHERRY_PICK_HEAD`).catch(() => {})
        await pfs.unlink(`${gitdir}/CHERRY_PICK_MSG`).catch(() => {})
        if (currentBranch) {
          await git.checkout({ fs, dir: root, gitdir, ref: currentBranch, force: true })
          await refreshTree()
        }
        appendOutput(['Cherry-pick aborted.'])
        return
      }
      if (!action) {
        appendOutput(['fatal: cherry-pick requires a commit'])
        return
      }
      const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })
      const hasChanges = statusMatrix.some(
        ([filepath, head, workdir, stage]) =>
          !filepath.startsWith('.remotes/') && (head !== workdir || head !== stage)
      )
      if (hasChanges) {
        appendOutput(['fatal: cherry-pick requires a clean working tree.'])
        return
      }
      let commitOid = action
      let commit
      try {
        if (
          action === 'HEAD' ||
          action.includes('~') ||
          action.includes('^')
        ) {
          commitOid = await resolveCommitish(fs, root, gitdir, action)
        } else if (/^[0-9a-f]{4,39}$/i.test(action)) {
          commitOid = await git.expandOid({ fs, dir: root, gitdir, oid: action })
        } else {
          try {
            commitOid = await git.resolveRef({ fs, dir: root, gitdir, ref: action })
          } catch (refError) {
            commitOid = await git.resolveRef({
              fs,
              dir: root,
              gitdir,
              ref: `refs/heads/${action}`,
            })
          }
        }
        const commitData = await git.readCommit({ fs, dir: root, gitdir, oid: commitOid })
        commit = commitData.commit
        commitOid = commitData.oid
      } catch (error) {
        appendOutput([`fatal: bad revision '${action}'`])
        return
      }
      const headOid = await git.resolveRef({
        fs,
        dir: root,
        gitdir,
        ref: currentBranch || 'HEAD',
      })
      const { conflictFiles, changedFiles } = await applyCommitChanges({
        fs,
        pfs,
        root,
        gitdir,
        commitOid,
        headOid,
      })
      await refreshTree()
      if (conflictFiles.length > 0) {
        await pfs.writeFile(`${gitdir}/CHERRY_PICK_HEAD`, `${commitOid}\n`).catch(() => {})
        await pfs.writeFile(
          `${gitdir}/CHERRY_PICK_MSG`,
          `${commit.message.split('\n')[0]}\n`
        ).catch(() => {})
        appendOutput([
          'Automatic cherry-pick failed; fix conflicts and run "git cherry-pick --continue".',
          ...conflictFiles.map((file) => `CONFLICT (content): ${file}`),
        ])
        return
      }
      if (changedFiles.length === 0) {
        appendOutput(['Nothing to apply.'])
        return
      }
      const sha = await git.commit({
        fs,
        dir: root,
        gitdir,
        author: { name: 'Learner', email: 'learner@example.com' },
        message: commit.message,
      })
      appendOutput([`[${currentBranch || 'HEAD'} ${sha.slice(0, 7)}] ${commit.message.split('\n')[0]}`])
    } catch (error) {
      appendOutput([`fatal: ${error.message}`])
    }
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
