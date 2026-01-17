const ensureDir = async (pfs, path) => {
  try {
    await pfs.mkdir(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }
}

const isDirStat = (stats) => stats?.type === 'dir' || stats?.isDirectory?.()

const copyDir = async (pfs, source, destination) => {
  try {
    await ensureDir(pfs, destination)
    const entries = await pfs.readdir(source)
    for (const entry of entries) {
      const fromPath = `${source}/${entry}`
      const toPath = `${destination}/${entry}`
      const stats = pfs.lstat ? await pfs.lstat(fromPath) : await pfs.stat(fromPath)
      if (stats.isSymbolicLink?.()) {
        if (!pfs.readlink || !pfs.symlink) {
          const content = await pfs.readFile(fromPath)
          await pfs.writeFile(toPath, content)
          continue
        }
        const linkTarget = await pfs.readlink(fromPath)
        await pfs.symlink(linkTarget, toPath)
        continue
      }
      if (isDirStat(stats)) {
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

const copyWorkingTree = async (pfs, source, destination) => {
  const entries = await pfs.readdir(source)
  for (const entry of entries) {
    if (entry === '.git' || entry === '.edu_git_remote.json') {
      continue
    }
    const fromPath = `${source}/${entry}`
    const toPath = `${destination}/${entry}`
    const stats = pfs.lstat ? await pfs.lstat(fromPath) : await pfs.stat(fromPath)
    if (stats.isSymbolicLink?.()) {
      if (!pfs.readlink || !pfs.symlink) {
        const content = await pfs.readFile(fromPath)
        await pfs.writeFile(toPath, content)
        continue
      }
      const linkTarget = await pfs.readlink(fromPath)
      await pfs.symlink(linkTarget, toPath)
      continue
    }
    if (isDirStat(stats)) {
      await ensureDir(pfs, toPath)
      await copyWorkingTree(pfs, fromPath, toPath)
    } else {
      const content = await pfs.readFile(fromPath)
      await pfs.writeFile(toPath, content)
    }
  }
}

export {
  ensureDir,
  isDirStat,
  copyDir,
  copyWorkingTree,
}
