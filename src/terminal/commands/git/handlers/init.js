import git from 'isomorphic-git'
import { registry } from '../registry'

const handler = async (args, context) => {
  const {
    fs,
    cwdPath,
    statPath,
    appendOutput,
    setGitInitialized,
    setGitRoot,
    setBranchName,
  } = context

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
}

registry.register('init', {
  middleware: [],
  handler,
  description: 'Create an empty Git repository',
})

export default handler
