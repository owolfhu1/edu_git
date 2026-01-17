import git from 'isomorphic-git'
import { createFsFromVolume, Volume } from 'memfs'
import { createCommands } from '../../src/terminal/commands/index.js'

let workspaceCounter = 0

/**
 * Test harness for git command testing.
 * Provides an isolated in-memory filesystem with git support.
 */
export class GitTestWorkspace {
  constructor(fs, dir) {
    this.fs = fs
    this.pfs = fs.promises
    this.dir = dir
    this.gitdir = `${dir === '/' ? '' : dir}/.git`
    this.cwd = dir
    this.output = []
    this.commands = createCommands()
  }

  /**
   * Create a new test workspace with optional initial files and git setup.
   */
  static async create(options = {}) {
    workspaceCounter++
    const vol = new Volume()
    const fs = createFsFromVolume(vol)

    // Add promises API if not present
    if (!fs.promises) {
      fs.promises = {
        readFile: (path, encoding) => new Promise((resolve, reject) => {
          fs.readFile(path, encoding, (err, data) => err ? reject(err) : resolve(data))
        }),
        writeFile: (path, data, encoding) => new Promise((resolve, reject) => {
          fs.writeFile(path, data, encoding, (err) => err ? reject(err) : resolve())
        }),
        mkdir: (path, options) => new Promise((resolve, reject) => {
          fs.mkdir(path, options, (err) => err ? reject(err) : resolve())
        }),
        rmdir: (path, options) => new Promise((resolve, reject) => {
          if (options?.recursive) {
            // memfs rmdir doesn't support recursive, use rm
            fs.rm(path, { recursive: true }, (err) => err ? reject(err) : resolve())
          } else {
            fs.rmdir(path, (err) => err ? reject(err) : resolve())
          }
        }),
        readdir: (path) => new Promise((resolve, reject) => {
          fs.readdir(path, (err, files) => err ? reject(err) : resolve(files))
        }),
        stat: (path) => new Promise((resolve, reject) => {
          fs.stat(path, (err, stats) => {
            if (err) return reject(err)
            resolve({
              ...stats,
              type: stats.isDirectory() ? 'dir' : 'file',
              isDirectory: () => stats.isDirectory(),
              isFile: () => stats.isFile(),
            })
          })
        }),
        unlink: (path) => new Promise((resolve, reject) => {
          fs.unlink(path, (err) => err ? reject(err) : resolve())
        }),
        rm: (path, options) => new Promise((resolve, reject) => {
          fs.rm(path, options, (err) => err ? reject(err) : resolve())
        }),
      }
    }

    const dir = options.dir || '/'

    // Ensure root directory exists
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      // Ignore if exists
    }

    const workspace = new GitTestWorkspace(fs, dir)

    // Create initial files
    if (options.files) {
      for (const [path, content] of Object.entries(options.files)) {
        await workspace.writeFile(path, content)
      }
    }

    // Initialize git if requested
    if (options.git?.init) {
      await git.init({
        fs,
        dir,
        defaultBranch: options.git.defaultBranch || 'main',
      })

      // Create initial commit if requested and files exist
      if (options.git.initialCommit && options.files) {
        for (const path of Object.keys(options.files)) {
          const filepath = path.startsWith('/') ? path.slice(1) : path
          await git.add({ fs, dir, filepath })
        }
        await git.commit({
          fs,
          dir,
          message: options.git.initialMessage || 'Initial commit',
          author: { name: 'Test', email: 'test@example.com' },
        })
      }
    }

    return workspace
  }

  /**
   * Write a file, creating parent directories as needed.
   */
  async writeFile(relativePath, content) {
    const fullPath = this.resolvePath(relativePath)
    const parts = fullPath.split('/').filter(Boolean)

    // Create parent directories
    let current = ''
    for (let i = 0; i < parts.length - 1; i++) {
      current += '/' + parts[i]
      try {
        this.fs.mkdirSync(current)
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
      }
    }

    await this.pfs.writeFile(fullPath, content, 'utf8')
  }

  /**
   * Read a file's contents.
   */
  async readFile(relativePath) {
    const fullPath = this.resolvePath(relativePath)
    return await this.pfs.readFile(fullPath, 'utf8')
  }

  /**
   * Check if a file or directory exists.
   */
  async exists(relativePath) {
    try {
      await this.pfs.stat(this.resolvePath(relativePath))
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a file.
   */
  async deleteFile(relativePath) {
    await this.pfs.unlink(this.resolvePath(relativePath))
  }

  /**
   * Run a terminal command and capture output.
   */
  async run(commandString) {
    this.output = []
    const parts = commandString.trim().split(/\s+/)
    const [cmd, ...args] = parts

    const context = this.buildContext()

    const handler = this.commands[cmd]
    if (!handler) {
      throw new Error(`Unknown command: ${cmd}`)
    }

    await handler(args, context)

    return {
      output: this.output.join('\n'),
      lines: [...this.output],
    }
  }

  /**
   * Shorthand for running git commands.
   */
  async git(subcommand) {
    return this.run(`git ${subcommand}`)
  }

  /**
   * Build the context object expected by command handlers.
   */
  buildContext() {
    const self = this
    return {
      fs: this.fs,
      cwdPath: this.cwd,
      statPath: async (path) => {
        try {
          const stat = await self.pfs.stat(path)
          return { type: stat.isDirectory() ? 'dir' : 'file' }
        } catch {
          return null
        }
      },
      readDirectory: async (path) => {
        try {
          return await self.pfs.readdir(path)
        } catch {
          return null
        }
      },
      readTextFile: async (path) => {
        try {
          return await self.pfs.readFile(path, 'utf8')
        } catch {
          return null
        }
      },
      createFile: async ({ parentId, name, content = '' }) => {
        const dir = parentId || '/'
        const path = `${dir}/${name}`.replace(/\/+/g, '/')
        try {
          await self.pfs.stat(path)
          return false
        } catch {
          await self.pfs.writeFile(path, content, 'utf8')
          return true
        }
      },
      updateFileContent: async (path, content) => {
        await self.pfs.writeFile(path, content, 'utf8')
      },
      createFolder: async ({ parentId, name }) => {
        const dir = parentId || '/'
        const path = `${dir}/${name}`.replace(/\/+/g, '/')
        try {
          await self.pfs.mkdir(path)
          return true
        } catch {
          return false
        }
      },
      deleteNode: async (path) => {
        try {
          const stat = await self.pfs.stat(path)
          if (stat.isDirectory()) {
            await self.rmrf(path)
          } else {
            await self.pfs.unlink(path)
          }
        } catch {
          // Ignore
        }
      },
      refreshTree: async () => {},
      appendOutput: (lines) => self.output.push(...lines),
      setLines: (lines) => { self.output = lines },
      setCwdPath: (path) => { self.cwd = path },
      setGitInitialized: () => {},
      setGitRoot: () => {},
      gitInitialized: true,
      gitRoot: this.dir,
      setBranchName: () => {},
    }
  }

  /**
   * Recursively remove a directory.
   */
  async rmrf(path) {
    try {
      const entries = await this.pfs.readdir(path)
      for (const entry of entries) {
        const entryPath = `${path}/${entry}`
        const stat = await this.pfs.stat(entryPath)
        if (stat.isDirectory()) {
          await this.rmrf(entryPath)
        } else {
          await this.pfs.unlink(entryPath)
        }
      }
      await this.pfs.rmdir(path)
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get current branch name.
   */
  async getBranch() {
    return await git.currentBranch({
      fs: this.fs,
      dir: this.dir,
      fullname: false,
    })
  }

  /**
   * Get list of all local branches.
   */
  async getBranches() {
    return await git.listBranches({
      fs: this.fs,
      dir: this.dir,
    })
  }

  /**
   * Get commit log.
   */
  async getLog(depth = 100) {
    return await git.log({
      fs: this.fs,
      dir: this.dir,
      depth,
    })
  }

  /**
   * Get number of commits.
   */
  async getCommitCount() {
    const log = await this.getLog()
    return log.length
  }

  /**
   * Get current HEAD SHA.
   */
  async getHead() {
    return await git.resolveRef({
      fs: this.fs,
      dir: this.dir,
      ref: 'HEAD',
    })
  }

  /**
   * Check if working tree is clean.
   */
  async isClean() {
    const matrix = await git.statusMatrix({
      fs: this.fs,
      dir: this.dir,
    })
    return matrix.every(([, head, workdir, stage]) =>
      head === workdir && workdir === stage
    )
  }

  /**
   * Check if currently in a merge state.
   */
  async isInMerge() {
    try {
      await this.pfs.stat(`${this.gitdir}/MERGE_HEAD`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if currently in a rebase state.
   */
  async isInRebase() {
    try {
      await this.pfs.stat(`${this.gitdir}/rebase-merge`)
      return true
    } catch {
      try {
        await this.pfs.stat(`${this.gitdir}/rebase-apply`)
        return true
      } catch {
        try {
          await this.pfs.stat(`${this.gitdir}/REBASE_HEAD`)
          return true
        } catch {
          try {
            await this.pfs.stat(`${this.gitdir}/REBASE_TODO`)
            return true
          } catch {
            return false
          }
        }
      }
    }
  }

  /**
   * Check if currently in a cherry-pick state.
   */
  async isInCherryPick() {
    try {
      await this.pfs.stat(`${this.gitdir}/CHERRY_PICK_HEAD`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get stash entries.
   */
  async getStashList() {
    try {
      const content = await this.pfs.readFile(`${this.gitdir}/edu-stash.json`, 'utf8')
      return JSON.parse(content)
    } catch {
      return []
    }
  }

  /**
   * Set up a merge conflict scenario.
   */
  async setupConflict(filename, baseContent, oursContent, theirsContent) {
    await this.writeFile(filename, baseContent)
    await this.git(`add ${filename}`)
    await this.git('commit -m "Base commit"')

    await this.git('checkout -b theirs')
    await this.writeFile(filename, theirsContent)
    await this.git(`add ${filename}`)
    await this.git('commit -m "Their changes"')

    await this.git('checkout main')
    await this.writeFile(filename, oursContent)
    await this.git(`add ${filename}`)
    await this.git('commit -m "Our changes"')
  }

  /**
   * Set up a remote repository.
   */
  async setupRemote(remoteName) {
    const remotePath = `/.remotes/${remoteName}`
    const remoteGitdir = `${remotePath}/.git`

    try {
      this.fs.mkdirSync('/.remotes', { recursive: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    try {
      this.fs.mkdirSync(remotePath, { recursive: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }

    await git.init({
      fs: this.fs,
      dir: remotePath,
      defaultBranch: 'main',
    })

    return { remotePath, remoteGitdir }
  }

  /**
   * Resolve a path relative to cwd.
   */
  resolvePath(relativePath) {
    if (relativePath.startsWith('/')) {
      return relativePath
    }
    const base = this.cwd === '/' ? '' : this.cwd
    return `${base}/${relativePath}`.replace(/\/+/g, '/')
  }

  /**
   * Change working directory.
   */
  cd(path) {
    if (path.startsWith('/')) {
      this.cwd = path
    } else if (path === '..') {
      const parts = this.cwd.split('/').filter(Boolean)
      parts.pop()
      this.cwd = '/' + parts.join('/')
    } else {
      this.cwd = this.resolvePath(path)
    }
  }

  /**
   * List files in a directory.
   */
  async listFiles(relativePath = '/') {
    const fullPath = this.resolvePath(relativePath)
    try {
      return await this.pfs.readdir(fullPath)
    } catch {
      return null
    }
  }

  /**
   * Recursively list all files in the workspace (excluding .git).
   * Returns array of paths relative to workspace root.
   */
  async listAllFiles(dir = '/', prefix = '') {
    const results = []
    const entries = await this.pfs.readdir(dir)

    for (const entry of entries) {
      if (entry === '.git') continue // Skip git internals

      const fullPath = `${dir === '/' ? '' : dir}/${entry}`
      const relativePath = prefix ? `${prefix}/${entry}` : entry
      const stat = await this.pfs.stat(fullPath)

      if (stat.isDirectory()) {
        results.push({ path: relativePath, type: 'dir' })
        const nested = await this.listAllFiles(fullPath, relativePath)
        results.push(...nested)
      } else {
        results.push({ path: relativePath, type: 'file' })
      }
    }

    return results
  }

  /**
   * Get a snapshot of the file structure (paths only, no .git).
   * Returns sorted array of file paths.
   */
  async getFileTree() {
    const all = await this.listAllFiles()
    return all
      .filter(f => f.type === 'file')
      .map(f => f.path)
      .sort()
  }

  /**
   * Get a snapshot of files with their contents.
   * Useful for comparing before/after states.
   */
  async getSnapshot(paths) {
    const snapshot = {}
    const filesToRead = paths || (await this.getFileTree())

    for (const path of filesToRead) {
      try {
        snapshot[path] = await this.readFile(path)
      } catch {
        snapshot[path] = null // File doesn't exist
      }
    }

    return snapshot
  }

  /**
   * Assert file structure matches expected.
   * @param {string[]} expectedFiles - Array of expected file paths
   */
  async expectFiles(expectedFiles) {
    const actual = await this.getFileTree()
    const expected = [...expectedFiles].sort()

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `File structure mismatch:\n` +
        `Expected: ${JSON.stringify(expected)}\n` +
        `Actual: ${JSON.stringify(actual)}`
      )
    }
  }

  /**
   * Debug helper.
   */
  async debug() {
    console.log('=== Workspace Debug ===')
    console.log('CWD:', this.cwd)
    console.log('Branch:', await this.getBranch())
    console.log('Clean:', await this.isClean())
    console.log('Commits:', await this.getCommitCount())
    console.log('In Merge:', await this.isInMerge())
    console.log('In Rebase:', await this.isInRebase())
    console.log('Last output:', this.output.slice(-5))
  }
}

export const createWorkspace = GitTestWorkspace.create.bind(GitTestWorkspace)
