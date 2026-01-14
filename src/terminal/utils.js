const getRelativePath = (root, absolutePath) => {
  if (!absolutePath.startsWith(root)) {
    return absolutePath.replace(/^\//, '')
  }
  const rel = absolutePath.slice(root.length)
  return rel.replace(/^\/+/, '')
}

const normalizePath = (input, cwdPath) => {
  if (!input || input === '.') {
    return cwdPath
  }
  const isAbsolute = input.startsWith('/')
  const base = isAbsolute ? [] : cwdPath.split('/').filter(Boolean)
  const parts = input.split('/').filter((segment) => segment.length > 0)
  const stack = [...base]
  for (const part of parts) {
    if (part === '.') {
      continue
    }
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join('/')}`
}

const ensureDirPath = (path) => (path === '' ? '/' : path)

const toAbsolutePath = (root, filepath) =>
  root === '/' ? `/${filepath}` : `${root}/${filepath}`

const splitPath = (path) => {
  if (path === '/') {
    return { dirPath: '/', name: '' }
  }
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() || ''
  return { dirPath: `/${segments.join('/')}`, name }
}

export {
  ensureDirPath,
  getRelativePath,
  normalizePath,
  splitPath,
  toAbsolutePath,
}
