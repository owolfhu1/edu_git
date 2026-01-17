import git from 'isomorphic-git'
import { registry } from '../registry'
import { getRelativePath, normalizePath } from '../../../utils'

const handler = async (args, context) => {
  const { fs, root, gitdir, cwdPath, appendOutput } = context

  const target = args[0]
  if (!target) {
    appendOutput(['fatal: pathspec missing'])
    return
  }

  try {
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
}

registry.register('add', {
  middleware: ['requireRepo'],
  handler,
  description: 'Add file contents to the index',
})

export default handler
