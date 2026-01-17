/**
 * Tests for git diff, restore, and checkout -- commands.
 * Migrated from cypress/e2e/git_cheat_sheet_commands.cy.js (partial)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git diff and restore commands', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'initial content',
        'docs/setup.txt': 'setup content',
      },
      git: { init: true, initialCommit: true },
    })
  })

  describe('git diff', () => {
    it('shows unstaged changes', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      const { output } = await ws.git('diff')
      expect(output).toContain('diff')
      expect(output).toContain('src/index.txt')
    })

    it('shows staged changes with --staged', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      await ws.git('add src/index.txt')
      const { output } = await ws.git('diff --staged')
      expect(output).toContain('diff')
      expect(output).toContain('src/index.txt')
    })

    it('shows no diff when no changes', async () => {
      const { output } = await ws.git('diff')
      expect(output).not.toContain('diff --')
    })

    it('shows no staged diff when nothing staged', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      const { output } = await ws.git('diff --staged')
      expect(output).not.toContain('diff --')
    })
  })

  describe('git restore --staged', () => {
    it('unstages a file', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      await ws.git('add src/index.txt')

      // Verify it's staged
      let { output: before } = await ws.git('diff --staged')
      expect(before).toContain('src/index.txt')

      // Unstage
      await ws.git('restore --staged src/index.txt')

      // Verify it's no longer staged
      const { output: after } = await ws.git('diff --staged')
      expect(after).not.toContain('src/index.txt')

      // But still modified
      const { output: status } = await ws.git('status')
      expect(status).toContain('Changes not staged for commit')
    })
  })

  describe('git restore', () => {
    it('discards working directory changes', async () => {
      const original = await ws.readFile('src/index.txt')
      await ws.writeFile('src/index.txt', 'modified content')

      await ws.git('restore src/index.txt')

      const restored = await ws.readFile('src/index.txt')
      expect(restored).toBe(original)
    })

    it('results in clean working tree', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      await ws.git('restore src/index.txt')

      const { output } = await ws.git('status')
      expect(output).toContain('nothing to commit')
    })
  })

  describe('git checkout -- <file>', () => {
    it('discards working directory changes (legacy syntax)', async () => {
      const original = await ws.readFile('src/index.txt')
      await ws.writeFile('src/index.txt', 'modified content')

      await ws.git('checkout -- src/index.txt')

      const restored = await ws.readFile('src/index.txt')
      expect(restored).toBe(original)
    })

    it('results in clean working tree', async () => {
      await ws.writeFile('src/index.txt', 'modified content')
      await ws.git('checkout -- src/index.txt')

      const { output } = await ws.git('status')
      expect(output).toMatch(/nothing to commit|working tree clean/)
    })
  })

  describe('combined staging and restore flow', () => {
    it('handles add, unstage, and restore workflow', async () => {
      // Read original content first
      const original = await ws.readFile('src/index.txt')

      // Make a clearly different change
      await ws.writeFile('src/index.txt', original + '\nNew workflow line added')

      // Verify file is modified (check status contains the file or 'modified')
      const { output: statusBefore } = await ws.git('status')
      expect(statusBefore).toMatch(/modified|src\/index\.txt|Changes not staged/)

      // Stage
      await ws.git('add src/index.txt')

      // Show staged diff
      const { output: staged } = await ws.git('diff --staged')
      expect(staged).toContain('src/index.txt')

      // Unstage with restore --staged
      await ws.git('restore --staged src/index.txt')

      // Verify unstaged
      const { output: noStaged } = await ws.git('diff --staged')
      expect(noStaged).not.toContain('src/index.txt')

      // Stage again
      await ws.git('add src/index.txt')

      // Unstage with reset HEAD
      await ws.git('reset HEAD src/index.txt')

      // Verify unstaged again
      const { output: noStagedAgain } = await ws.git('diff --staged')
      expect(noStagedAgain).not.toContain('src/index.txt')

      // Discard changes
      await ws.git('restore src/index.txt')

      // Verify clean
      const { output: status } = await ws.git('status')
      expect(status).toMatch(/nothing to commit|working tree clean/)

      // Verify content is restored
      const restored = await ws.readFile('src/index.txt')
      expect(restored).toBe(original)
    })
  })
})
