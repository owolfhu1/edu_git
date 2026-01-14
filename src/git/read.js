import git from 'isomorphic-git'
import { normalizeGitPath } from './paths'

const decodeContent = (content) => {
  if (!content) {
    return ''
  }
  if (typeof content === 'string') {
    return content
  }
  return new TextDecoder().decode(content)
}

const readTreeContent = async (fs, root, gitdir, tree, targetPath) => {
  const normalizedTarget = normalizeGitPath(targetPath)
  let content = null
  await git.walk({
    fs,
    dir: root,
    gitdir,
    trees: [tree],
    map: async (filepath, [entry]) => {
      const normalizedPath = normalizeGitPath(filepath)
      if (normalizedPath !== normalizedTarget) {
        return null
      }
      if (entry) {
        content = await entry.content()
      }
      return null
    },
  })
  return decodeContent(content)
}

const readBlobAtPath = async (fs, root, gitdir, ref, targetPath) => {
  const normalizedTarget = normalizeGitPath(targetPath)
  if (!normalizedTarget) {
    return ''
  }
  let treeOid
  try {
    const commitOid = await git.resolveRef({ fs, dir: root, gitdir, ref })
    const { commit } = await git.readCommit({ fs, dir: root, gitdir, oid: commitOid })
    treeOid = commit.tree
  } catch (error) {
    return ''
  }

  const parts = normalizedTarget.split('/')
  let currentTree = treeOid
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const { tree } = await git.readTree({ fs, dir: root, gitdir, oid: currentTree })
    const entry = tree.find((item) => item.path === part)
    if (!entry) {
      return ''
    }
    if (index === parts.length - 1) {
      if (entry.type !== 'blob') {
        return ''
      }
      const { blob } = await git.readBlob({ fs, dir: root, gitdir, oid: entry.oid })
      return decodeContent(blob)
    }
    if (entry.type !== 'tree') {
      return ''
    }
    currentTree = entry.oid
  }
  return ''
}

export { decodeContent, readBlobAtPath, readTreeContent }
