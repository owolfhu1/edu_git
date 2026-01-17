/**
 * Tests for git stash commands.
 * Migrated from cypress/e2e/stash.cy.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git stash commands', () => {
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

  describe('stash and apply', () => {
    it('stashes tracked changes and applies them', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      await ws.git('stash -m "test stash"')

      // After stash, working tree should be clean
      const { output: statusOutput } = await ws.git('status')
      expect(statusOutput).toContain('nothing to commit')

      // Stash list should contain our stash
      const { output: listOutput } = await ws.git('stash list')
      expect(listOutput).toContain('stash@{0}')
      expect(listOutput).toContain('test stash')

      // Apply should restore changes
      await ws.git('stash apply')
      const content = await ws.readFile('src/index.txt')
      expect(content).toBe('modified content')
    })

    it('stashes untracked files and restores them', async () => {
      await ws.writeFile('docs/new-file.txt', 'new file content')

      // Verify file exists
      expect(await ws.exists('docs/new-file.txt')).toBe(true)

      await ws.git('stash -m "untracked"')

      // File should be gone
      expect(await ws.exists('docs/new-file.txt')).toBe(false)

      await ws.git('stash pop')

      // File should be back
      expect(await ws.exists('docs/new-file.txt')).toBe(true)
      const content = await ws.readFile('docs/new-file.txt')
      expect(content).toBe('new file content')
    })
  })

  describe('stash pop', () => {
    it('pops a stash and removes it from the list', async () => {
      await ws.writeFile('docs/setup.txt', 'modified setup')
      await ws.git('stash -m "pop me"')

      const { output: beforePop } = await ws.git('stash list')
      expect(beforePop).toContain('stash@{0}')

      await ws.git('stash pop')

      const { output: afterPop } = await ws.git('stash list')
      expect(afterPop).not.toContain('stash@{0}')

      const content = await ws.readFile('docs/setup.txt')
      expect(content).toBe('modified setup')
    })
  })

  describe('stash by index', () => {
    it('applies a specific stash by index', async () => {
      await ws.git('stash clear')

      // Create first stash
      await ws.writeFile('docs/overview.txt', 'first stash content')
      await ws.git('stash -m "first"')

      // Create second stash
      await ws.writeFile('docs/setup.txt', 'second stash content')
      await ws.git('stash -m "second"')

      // Verify both stashes exist
      const { output: listOutput } = await ws.git('stash list')
      expect(listOutput).toContain('stash@{0}')
      expect(listOutput).toContain('stash@{1}')

      // Apply the older stash (stash@{1})
      const { output: applyOutput } = await ws.git('stash apply stash@{1}')
      expect(applyOutput.toLowerCase()).toMatch(/applied|stash/)

      const content = await ws.readFile('docs/overview.txt')
      expect(content).toBe('first stash content')
    })
  })

  describe('stash drop and clear', () => {
    it('drops a specific stash', async () => {
      await ws.writeFile('docs/overview.txt', 'drop content')
      await ws.git('stash -m "drop me"')

      const { output: beforeDrop } = await ws.git('stash list')
      expect(beforeDrop).toContain('stash@{0}')

      await ws.git('stash drop stash@{0}')

      const { output: afterDrop } = await ws.git('stash list')
      expect(afterDrop).not.toContain('stash@{0}')
    })

    it('clears all stashes', async () => {
      // Read original content
      const original = await ws.readFile('src/index.txt')

      // Create a clearly different modification
      await ws.writeFile('src/index.txt', original + '\nClear stash test line')

      // Verify we have changes before stashing
      const { output: statusBefore } = await ws.git('status')
      expect(statusBefore).toMatch(/modified|Changes not staged|src\/index\.txt/)

      // Stash the changes
      await ws.git('stash -m "clear me"')

      // Verify working tree is now clean
      const { output: statusAfter } = await ws.git('status')
      expect(statusAfter).toMatch(/nothing to commit|working tree clean/)

      // Verify stash list shows the stash
      const { output: listBefore } = await ws.git('stash list')
      expect(listBefore).toContain('clear me')

      // Clear stashes
      await ws.git('stash clear')

      // Verify stash list is empty
      const { output: listAfter } = await ws.git('stash list')
      expect(listAfter).not.toContain('clear me')
    })
  })

  describe('stash conflicts', () => {
    it('reports conflicts when applying a stash', async () => {
      // Stash some changes
      await ws.writeFile('docs/overview.txt', 'stashed version')
      await ws.git('stash -m "conflict"')

      // Make conflicting changes in working directory
      await ws.writeFile('docs/overview.txt', 'current version')

      // Apply should create conflict markers
      await ws.git('stash apply')

      const content = await ws.readFile('docs/overview.txt')
      expect(content).toContain('<<<<<<<')
      expect(content).toContain('=======')
      expect(content).toContain('>>>>>>>')
    })
  })
})
