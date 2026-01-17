const STASH_FILE = 'EDU_GIT_STASH.json'

const loadStash = async (pfs, gitdir) => {
  try {
    const content = await pfs.readFile(`${gitdir}/${STASH_FILE}`, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

const saveStash = async (pfs, gitdir, entries) => {
  await pfs.writeFile(`${gitdir}/${STASH_FILE}`, JSON.stringify(entries, null, 2))
}

export { STASH_FILE, loadStash, saveStash }
