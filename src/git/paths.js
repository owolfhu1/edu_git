const normalizeGitPath = (path) => path.replace(/^\/+/, '')

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

const findGitRootForPath = async (path, statPath) => {
  const base = path.split('/').slice(0, -1).join('/') || '/'
  return findGitRoot(base, statPath)
}

export { findGitRoot, findGitRootForPath, normalizeGitPath }
