/**
 * Tests for git reset command.
 * Migrated from cypress/e2e/reset.cy.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git reset', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'initial content',
        'docs/overview.txt': 'overview content',
        'docs/setup.txt': 'setup content',
      },
      git: { init: true, initialCommit: true },
    })
  })

  describe('reset --soft', () => {
    it('moves HEAD but keeps changes staged', async () => {
      // Make a commit
      await ws.writeFile('src/index.txt', 'first change')
      await ws.git('add .')
      await ws.git('commit -m "first"')

      // Make another commit
      await ws.writeFile('src/index.txt', 'second change')
      await ws.git('add .')
      await ws.git('commit -m "second"')

      // Soft reset to previous commit
      await ws.git('reset --soft HEAD~1')

      // Status should show staged changes
      const { output } = await ws.git('status')
      expect(output).toContain('Changes to be committed')

      // Staged diff should show the changes
      const { output: diffOutput } = await ws.git('diff --staged')
      expect(diffOutput).toContain('diff')
    })
  })

  describe('reset --mixed (default)', () => {
    it('moves HEAD and unstages changes', async () => {
      await ws.writeFile('src/index.txt', 'first change')
      await ws.git('add .')
      await ws.git('commit -m "first"')

      await ws.writeFile('src/index.txt', 'second change')
      await ws.git('add .')
      await ws.git('commit -m "second"')

      await ws.git('reset --soft HEAD~1')

      // Verify changes are staged
      let { output: beforeReset } = await ws.git('status')
      expect(beforeReset).toContain('Changes to be committed')

      // Mixed reset
      await ws.git('reset --mixed HEAD')

      // Changes should now be unstaged
      const { output } = await ws.git('status')
      expect(output).toContain('Changes not staged for commit')

      // Staged diff should be empty
      const { output: stagedDiff } = await ws.git('diff --staged')
      expect(stagedDiff).not.toContain('diff')
    })

    it('resets without mode flag (defaults to mixed)', async () => {
      await ws.writeFile('src/index.txt', 'modified')
      await ws.git('add .')

      await ws.git('reset HEAD')

      const { output } = await ws.git('status')
      expect(output).toContain('Changes not staged for commit')
    })
  })

  describe('reset --hard', () => {
    it('discards all changes', async () => {
      await ws.writeFile('src/index.txt', 'first change')
      await ws.git('add .')
      await ws.git('commit -m "first"')

      await ws.writeFile('src/index.txt', 'second change')
      await ws.git('add .')
      await ws.git('commit -m "second"')

      await ws.git('reset --hard HEAD~1')

      // Working tree should be clean
      const { output } = await ws.git('status')
      expect(output).toContain('nothing to commit')

      // File should have first change content
      const content = await ws.readFile('src/index.txt')
      expect(content).toBe('first change')
    })

    it('restores files to previous state', async () => {
      const original = await ws.readFile('src/index.txt')

      await ws.writeFile('src/index.txt', 'modified')
      await ws.git('add .')
      await ws.git('commit -m "modify"')

      await ws.git('reset --hard HEAD~1')

      const restored = await ws.readFile('src/index.txt')
      expect(restored).toBe(original)
    })
  })

  describe('reset with file path', () => {
    it('unstages a specific file with reset HEAD <file>', async () => {
      await ws.writeFile('docs/setup.txt', 'modified setup')
      await ws.git('add docs/setup.txt')

      // Verify it's staged
      let { output: beforeReset } = await ws.git('diff --staged')
      expect(beforeReset).toContain('setup.txt')

      // Reset just that file
      await ws.git('reset HEAD docs/setup.txt')

      // File should be unstaged
      const { output: afterReset } = await ws.git('diff --staged')
      expect(afterReset).not.toContain('setup.txt')

      // But still modified
      const { output: status } = await ws.git('status')
      expect(status).toContain('Changes not staged for commit')
    })
  })

  describe('reset to specific commit', () => {
    it('resets to a specific SHA', async () => {
      await ws.writeFile('docs/overview.txt', 'first')
      await ws.git('add .')
      await ws.git('commit -m "first"')

      const firstHead = await ws.getHead()
      const shortSha = firstHead.slice(0, 7)

      await ws.writeFile('docs/overview.txt', 'second')
      await ws.git('add .')
      await ws.git('commit -m "second"')

      await ws.git(`reset --hard ${shortSha}`)

      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain(shortSha)
    })

    it('keeps branch checked out after reset', async () => {
      await ws.writeFile('docs/overview.txt', 'change A')
      await ws.git('add .')
      await ws.git('commit -m "commit A"')

      await ws.writeFile('docs/overview.txt', 'change B')
      await ws.git('add .')
      await ws.git('commit -m "commit B"')

      await ws.git('reset --hard HEAD~1')

      const { output } = await ws.git('status')
      expect(output).toContain('On branch main')

      const content = await ws.readFile('docs/overview.txt')
      expect(content).toBe('change A')
    })
  })

  describe('reset with commitish refs', () => {
    it('resets to HEAD~n', async () => {
      await ws.writeFile('src/index.txt', 'commit 1')
      await ws.git('add .')
      await ws.git('commit -m "commit 1"')

      await ws.writeFile('src/index.txt', 'commit 2')
      await ws.git('add .')
      await ws.git('commit -m "commit 2"')

      await ws.writeFile('src/index.txt', 'commit 3')
      await ws.git('add .')
      await ws.git('commit -m "commit 3"')

      await ws.git('reset --hard HEAD~2')

      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('commit 1')
    })

    it('resets to HEAD^', async () => {
      await ws.writeFile('src/index.txt', 'parent')
      await ws.git('add .')
      await ws.git('commit -m "parent"')

      await ws.writeFile('src/index.txt', 'child')
      await ws.git('add .')
      await ws.git('commit -m "child"')

      await ws.git('reset --hard HEAD^')

      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('parent')
    })
  })
})
