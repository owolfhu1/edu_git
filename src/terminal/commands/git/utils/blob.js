import git from 'isomorphic-git'
import { normalizePath } from '../../../utils'

const readBlobByOid = async (fs, dir, gitdir, oid) => {
  if (!oid) {
    return ''
  }
  const { blob } = await git.readBlob({ fs, dir, gitdir, oid })
  return new TextDecoder().decode(blob)
}

const readBlobAtPathRaw = async (fs, dir, gitdir, ref, targetPath) => {
  const normalizedTarget = normalizePath(targetPath, '/').replace(/^\/+/, '')
  if (!normalizedTarget) {
    return null
  }
  let treeOid
  try {
    const commitOid = await git.resolveRef({ fs, dir, gitdir, ref })
    const { commit } = await git.readCommit({ fs, dir, gitdir, oid: commitOid })
    treeOid = commit.tree
  } catch (error) {
    return null
  }

  const parts = normalizedTarget.split('/')
  let currentTree = treeOid
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const { tree } = await git.readTree({ fs, dir, gitdir, oid: currentTree })
    const entry = tree.find((item) => item.path === part)
    if (!entry) {
      return null
    }
    if (index === parts.length - 1) {
      if (entry.type !== 'blob') {
        return null
      }
      const { blob } = await git.readBlob({ fs, dir, gitdir, oid: entry.oid })
      return blob
    }
    if (entry.type !== 'tree') {
      return null
    }
    currentTree = entry.oid
  }
  return null
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

export {
  readBlobByOid,
  readBlobAtPathRaw,
  buildBlobIndex,
}
