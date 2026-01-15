import git from 'isomorphic-git'

const ensureDir = async (pfs, path) => {
  try {
    await pfs.mkdir(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }
}

const ensureFile = async (pfs, path, content) => {
  try {
    await pfs.stat(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    await pfs.writeFile(path, content)
  }
}

const baseHelpers = `Helpers

formatLocation(trail):
  return trail.city + ", " + trail.state

sortTrails(trails):
  return trails.sortedBy(name)
`

export const seedMockConflictEnvironment = async ({ fs, pfs }) => {
  const ensureRemoteDir = async (path) => {
    try {
      await pfs.mkdir(path)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
    }
  }

  const copyDir = async (source, destination) => {
    const entries = await pfs.readdir(source)
    await ensureRemoteDir(destination)
    for (const entry of entries) {
      const fromPath = `${source}/${entry}`
      const toPath = `${destination}/${entry}`
      const stats = await pfs.stat(fromPath)
      if (stats.type === 'dir') {
        await copyDir(fromPath, toPath)
      } else {
        const content = await pfs.readFile(fromPath)
        await pfs.writeFile(toPath, content)
      }
    }
  }

  await ensureDir(pfs, '/src')
  await ensureDir(pfs, '/src/utils')
  await ensureDir(pfs, '/docs')
  await ensureFile(pfs, '/src/utils/helpers.txt', baseHelpers)
  await ensureFile(
    pfs,
    '/docs/notes.txt',
    'Conflict practice: edit helpers.txt on two branches.\n'
  )
  const gitdir = '/.git'
  await git.init({ fs, dir: '/', gitdir, defaultBranch: 'main' })
  const statusMatrix = await git.statusMatrix({ fs, dir: '/', gitdir })
  for (const [filepath] of statusMatrix) {
    await git.add({ fs, dir: '/', gitdir, filepath })
  }
  await git.commit({
    fs,
    dir: '/',
    gitdir,
    author: { name: 'Edu Git', email: 'edu@example.com' },
    message: 'init commit',
  })
  await git.branch({ fs, dir: '/', gitdir, ref: 'conflict_branch' })
  await git.checkout({ fs, dir: '/', gitdir, ref: 'conflict_branch' })
  await pfs.writeFile(
    '/src/utils/helpers.txt',
    `${baseHelpers.trimEnd()}\n\naddTestHelpers(name):\n  return "helper:" + name\n`
  )
  await git.add({ fs, dir: '/', gitdir, filepath: 'src/utils/helpers.txt' })
  await git.commit({
    fs,
    dir: '/',
    gitdir,
    author: { name: 'Learner', email: 'learner@example.com' },
    message: 'Add helper on conflict_branch',
  })
  await git.checkout({ fs, dir: '/', gitdir, ref: 'main' })
  await pfs.writeFile(
    '/src/utils/helpers.txt',
    `${baseHelpers.trimEnd()}\n\ndfdgh\ndfsgh\n`
  )
  await git.add({ fs, dir: '/', gitdir, filepath: 'src/utils/helpers.txt' })
  await git.commit({
    fs,
    dir: '/',
    gitdir,
    author: { name: 'Learner', email: 'learner@example.com' },
    message: 'Add notes on main',
  })
  await git.checkout({ fs, dir: '/', gitdir, ref: 'conflict_branch' })
  await git.setConfig({
    fs,
    dir: '/',
    gitdir,
    path: 'remote.origin.url',
    value: 'https://remote.mock/edu-git',
  })
  await git.setConfig({
    fs,
    dir: '/',
    gitdir,
    path: 'remote.origin.fetch',
    value: '+refs/heads/*:refs/remotes/origin/*',
  })
  await ensureRemoteDir('/.remotes')
  await ensureRemoteDir('/.remotes/origin')
  const remotePath = '/.remotes/origin'
  const remoteGitdir = '/.remotes/origin/.git'
  await git.init({ fs, dir: remotePath, gitdir: remoteGitdir, defaultBranch: 'main' })
  await copyDir(gitdir, remoteGitdir)
  const mainOid = await git.resolveRef({ fs, dir: '/', gitdir, ref: 'main' })
  const conflictOid = await git.resolveRef({
    fs,
    dir: '/',
    gitdir,
    ref: 'conflict_branch',
  })
  await git.writeRef({
    fs,
    dir: remotePath,
    gitdir: remoteGitdir,
    ref: 'refs/heads/main',
    value: mainOid,
    force: true,
  })
  await git.writeRef({
    fs,
    dir: remotePath,
    gitdir: remoteGitdir,
    ref: 'refs/heads/conflict_branch',
    value: conflictOid,
    force: true,
  })
  return { openFilePath: '/src/utils/helpers.txt' }
}
