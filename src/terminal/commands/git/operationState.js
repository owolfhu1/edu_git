const OPERATION_FILES = {
  merge: {
    head: 'MERGE_HEAD',
    msg: 'MERGE_MSG',
  },
  rebase: {
    head: 'REBASE_HEAD',
    orig: 'REBASE_ORIG_HEAD',
    todo: 'REBASE_TODO',
    index: 'REBASE_INDEX',
    current: 'REBASE_CURRENT',
    conflicts: 'REBASE_CONFLICTS',
  },
  cherryPick: {
    head: 'CHERRY_PICK_HEAD',
    msg: 'CHERRY_PICK_MSG',
  },
}

const isInProgress = async (pfs, gitdir, operation) => {
  const files = OPERATION_FILES[operation]
  if (!files || !files.head) {
    return false
  }
  try {
    await pfs.readFile(`${gitdir}/${files.head}`, 'utf8')
    return true
  } catch (error) {
    return false
  }
}

const readState = async (pfs, gitdir, operation, key) => {
  const files = OPERATION_FILES[operation]
  if (!files || !files[key]) {
    return null
  }
  try {
    const content = await pfs.readFile(`${gitdir}/${files[key]}`, 'utf8')
    // Try to parse as JSON for complex state files
    if (key === 'todo' || key === 'conflicts') {
      try {
        return JSON.parse(content)
      } catch (parseError) {
        return content.trim()
      }
    }
    return content.trim()
  } catch (error) {
    return null
  }
}

const writeState = async (pfs, gitdir, operation, key, value) => {
  const files = OPERATION_FILES[operation]
  if (!files || !files[key]) {
    throw new Error(`Unknown operation/key: ${operation}/${key}`)
  }
  const content = typeof value === 'object' ? JSON.stringify(value) : `${value}\n`
  await pfs.writeFile(`${gitdir}/${files[key]}`, content)
}

const clearState = async (pfs, gitdir, operation) => {
  const files = OPERATION_FILES[operation]
  if (!files) {
    return
  }
  const unlinkPromises = Object.values(files).map((file) =>
    pfs.unlink(`${gitdir}/${file}`).catch(() => {})
  )
  await Promise.all(unlinkPromises)
}

export {
  OPERATION_FILES,
  isInProgress,
  readState,
  writeState,
  clearState,
}
