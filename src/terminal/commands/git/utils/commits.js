import git from 'isomorphic-git'
import { buildBlobIndex, readBlobByOid } from './blob'
import { mergeFileContents } from './merge'

const applyCommitChanges = async ({ fs, pfs, root, gitdir, commitOid, headOid, parentIndex = 0 }) => {
  const { commit } = await git.readCommit({ fs, dir: root, gitdir, oid: commitOid })
  const parentOid = commit.parent?.[parentIndex] || null
  const parentBlobs = await buildBlobIndex(fs, root, gitdir, parentOid)
  const targetIndex = await buildBlobIndex(fs, root, gitdir, commitOid)
  const headIndex = await buildBlobIndex(fs, root, gitdir, headOid)
  const paths = new Set([
    ...parentBlobs.keys(),
    ...targetIndex.keys(),
    ...headIndex.keys(),
  ])
  const conflictFiles = []
  const changedFiles = []
  const headLabel = 'HEAD'
  const targetLabel = commitOid.slice(0, 7)
  for (const path of paths) {
    const parentBlob = parentBlobs.get(path) || null
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
      parentCount: parentBlobs.size,
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

export { applyCommitChanges, hasUnresolvedConflicts }
