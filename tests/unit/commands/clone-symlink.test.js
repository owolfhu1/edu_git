/**
 * Tests for symlink preservation during clone.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import git from 'isomorphic-git'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git clone symlink behavior', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace()
  })

  it('preserves symlinks when cloning a remote repo', async () => {
    const remotePath = '/.remotes/symlink-repo'
    await ws.fs.promises.mkdir('/.remotes', { recursive: true })
    await ws.fs.promises.mkdir(remotePath, { recursive: true })

    await git.init({ fs: ws.fs, dir: remotePath, defaultBranch: 'main' })
    await ws.fs.promises.writeFile(`${remotePath}/target.txt`, 'target', 'utf8')

    ws.fs.symlinkSync('target.txt', `${remotePath}/link.txt`)

    await git.add({ fs: ws.fs, dir: remotePath, filepath: 'target.txt' })
    await git.add({ fs: ws.fs, dir: remotePath, filepath: 'link.txt' })
    await git.commit({
      fs: ws.fs,
      dir: remotePath,
      message: 'add symlink',
      author: { name: 'Test', email: 'test@example.com' },
    })

    const { output } = await ws.run('git clone https://remote.mock/symlink-repo clone-repo')
    expect(output.toLowerCase()).toContain('cloned')

    const stats = ws.fs.lstatSync('/clone-repo/link.txt')
    expect(stats.isSymbolicLink()).toBe(true)
  })
})
