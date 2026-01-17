import git from 'isomorphic-git'

const resolveCommitish = async (fs, dir, gitdir, ref) => {
  if (ref === 'HEAD') {
    return git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' })
  }
  if (!ref.includes('~') && !ref.includes('^')) {
    return git.resolveRef({ fs, dir, gitdir, ref })
  }
  const baseMatch = ref.match(/^[^~^]+/)
  const base = baseMatch?.[0] || 'HEAD'
  const remainder = ref.slice(base.length)
  if (remainder && !/^([~^]\d*)+$/.test(remainder)) {
    throw new Error(`invalid ref: ${ref}`)
  }

  let oid = await git.resolveRef({ fs, dir, gitdir, ref: base })
  const tokenRegex = /([~^])(\d*)/g
  let token
  while ((token = tokenRegex.exec(remainder)) !== null) {
    const op = token[1]
    const countRaw = token[2]
    const count = countRaw === '' ? 1 : Number(countRaw)
    if (Number.isNaN(count) || count < 1) {
      throw new Error(`invalid ref: ${ref}`)
    }
    if (op === '~') {
      for (let index = 0; index < count; index += 1) {
        const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
        if (!commit.parent?.length) {
          throw new Error(`invalid ref: ${ref}`)
        }
        oid = commit.parent[0]
      }
    } else {
      const parentIndex = count - 1
      const { commit } = await git.readCommit({ fs, dir, gitdir, oid })
      if (!commit.parent?.[parentIndex]) {
        throw new Error(`invalid ref: ${ref}`)
      }
      oid = commit.parent[parentIndex]
    }
  }
  return oid
}

export { resolveCommitish }
