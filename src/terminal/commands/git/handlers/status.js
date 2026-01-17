import git from 'isomorphic-git'
import { registry } from '../registry'

const handler = async (args, context) => {
  const {
    fs,
    root,
    gitdir,
    currentBranch,
    mergeHead,
    rebaseHead,
    appendOutput,
    setBranchName,
  } = context
  const pfs = fs.promises

  try {
    const statusMatrix = await git.statusMatrix({ fs, dir: root, gitdir })

    if (currentBranch) {
      appendOutput([`On branch ${currentBranch}`])
    } else {
      let headOid = null
      try {
        headOid = await git.resolveRef({ fs, dir: root, gitdir, ref: 'HEAD' })
      } catch (error) {
        headOid = null
      }
      if (headOid) {
        appendOutput([`HEAD detached at ${headOid.slice(0, 7)}`])
      } else {
        let fallback = null
        try {
          await pfs.stat(`${gitdir}/refs/heads/main`)
          fallback = 'main'
        } catch (error) {
          fallback = null
        }
        if (!fallback) {
          try {
            await pfs.stat(`${gitdir}/refs/heads/master`)
            fallback = 'master'
          } catch (error) {
            fallback = null
          }
        }
        appendOutput([`On branch ${fallback || 'unknown'}`])
      }
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
        const isNew = head === 0
        const isDeleted = stage === 0 && head !== 0
        staged.push({
          filepath,
          status: isDeleted ? 'deleted' : isNew ? 'new file' : 'modified',
        })
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
        appendOutput([`  ${item.status}: ${item.filepath}`])
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
}

registry.register('status', {
  middleware: ['requireRepo', 'loadCurrentBranch', 'checkMergeState', 'checkRebaseState'],
  handler,
  description: 'Show the working tree status',
})

export default handler
