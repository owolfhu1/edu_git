import git from 'isomorphic-git'
import { findGitRoot } from '../../../git/paths'

const requireRepo = async (args, context) => {
  const { cwdPath, statPath, appendOutput } = context
  const root = await findGitRoot(cwdPath, statPath)
  if (!root) {
    appendOutput(['fatal: not a git repository (or any of the parent directories): .git'])
    return null
  }
  const gitdir = `${root === '/' ? '' : root}/.git`
  return { ...context, root, gitdir }
}

const loadCurrentBranch = async (args, context) => {
  const { fs, root, gitdir, setBranchName } = context
  let currentBranch = null
  try {
    currentBranch = await git.currentBranch({
      fs,
      dir: root,
      gitdir,
      fullname: false,
    })
  } catch (error) {
    currentBranch = null
  }
  if (setBranchName) {
    setBranchName(currentBranch || 'detached')
  }
  return { ...context, currentBranch }
}

const checkMergeState = async (args, context) => {
  const { fs, gitdir } = context
  const pfs = fs.promises
  let mergeHead = null
  try {
    mergeHead = (await pfs.readFile(`${gitdir}/MERGE_HEAD`, 'utf8')).trim()
  } catch (error) {
    mergeHead = null
  }
  return { ...context, mergeHead }
}

const checkRebaseState = async (args, context) => {
  const { fs, gitdir } = context
  const pfs = fs.promises
  let rebaseHead = null
  try {
    rebaseHead = (await pfs.readFile(`${gitdir}/REBASE_HEAD`, 'utf8')).trim()
  } catch (error) {
    rebaseHead = null
  }
  return { ...context, rebaseHead }
}

const middlewareMap = {
  requireRepo,
  loadCurrentBranch,
  checkMergeState,
  checkRebaseState,
}

const runMiddleware = async (middlewareNames, args, context) => {
  let ctx = context
  for (const name of middlewareNames) {
    const middleware = middlewareMap[name]
    if (!middleware) {
      throw new Error(`Unknown middleware: ${name}`)
    }
    ctx = await middleware(args, ctx)
    if (ctx === null) {
      return null
    }
  }
  return ctx
}

export {
  requireRepo,
  loadCurrentBranch,
  checkMergeState,
  checkRebaseState,
  middlewareMap,
  runMiddleware,
}
