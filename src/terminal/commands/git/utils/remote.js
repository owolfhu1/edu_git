import git from 'isomorphic-git'
import { ensureDir } from './filesystem'

const REMOTE_ROOT = '/.remotes'

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

const parseRemoteUrl = (url) => {
  if (!url) {
    return null
  }
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'remote.mock') {
      return null
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length === 0) {
      return null
    }
    return segments[0]
  } catch (error) {
    return null
  }
}

export { REMOTE_ROOT, ensureRemoteRepo, parseRemoteUrl }
