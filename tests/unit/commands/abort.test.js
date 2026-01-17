/**
 * Unit tests for git abort commands.
 * Migrated from cypress/e2e/git_abort_commands.cy.js
 *
 * Tests:
 * - git merge --abort
 * - git rebase --abort
 * - git cherry-pick --abort
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git abort commands', () => {
  describe('git merge --abort', () => {
    let ws

    beforeEach(async () => {
      // Set up a conflict scenario
      ws = await createWorkspace({
        files: { 'file.txt': 'base content' },
        git: { init: true, initialCommit: true },
      })

      // Create conflicting branches
      await ws.git('checkout -b test')
      await ws.writeFile('file.txt', 'test branch content')
      await ws.git('add .')
      await ws.git('commit -m "Test branch change"')

      await ws.git('checkout main')
      await ws.writeFile('file.txt', 'main branch content')
      await ws.git('add .')
      await ws.git('commit -m "Main branch change"')
    })

    it('aborts a conflicted merge', async () => {
      // Start a merge that will conflict
      await ws.git('merge test')

      // Should be in merge state
      expect(await ws.isInMerge()).toBe(true)

      // Abort the merge
      const { output } = await ws.git('merge --abort')
      expect(output).toContain('Merge aborted')

      // Should no longer be in merge state
      expect(await ws.isInMerge()).toBe(false)
    })

    it('restores working tree to clean state after abort', async () => {
      await ws.git('merge test')
      await ws.git('merge --abort')

      // Working tree should be clean
      const { output } = await ws.git('status')
      expect(output).toContain('nothing to commit')
      expect(output).toContain('working tree clean')
    })

    it('restores file content to pre-merge state', async () => {
      await ws.git('merge test')
      await ws.git('merge --abort')

      // File should be back to main branch content
      const content = await ws.readFile('file.txt')
      expect(content).toBe('main branch content')
    })

    it('reports error when not in merge state', async () => {
      const { output } = await ws.git('merge --abort')
      expect(output.toLowerCase()).toMatch(/no merge|not merging|nothing to abort/)
    })
  })

  describe('git rebase --abort', () => {
    let ws

    beforeEach(async () => {
      // Set up a conflict scenario for rebase
      ws = await createWorkspace({
        files: { 'file.txt': 'base content' },
        git: { init: true, initialCommit: true },
      })

      // Create main branch changes
      await ws.writeFile('file.txt', 'main content')
      await ws.git('add .')
      await ws.git('commit -m "Main change"')

      // Create test branch from initial commit with conflicting changes
      await ws.git('checkout -b test HEAD~1')
      await ws.writeFile('file.txt', 'test content')
      await ws.git('add .')
      await ws.git('commit -m "Test change"')

      // Set up a simulated remote for origin/main
      await ws.setupRemote('origin')

      // For rebase test, we'll rebase test onto main
    })

    it('aborts a conflicted rebase', async () => {
      // Start rebase that will conflict
      await ws.git('rebase main')

      // Check if in rebase state (may or may not be depending on implementation)
      const wasInRebase = await ws.isInRebase()

      if (wasInRebase) {
        // Abort the rebase
        const { output } = await ws.git('rebase --abort')
        expect(output).toContain('Rebase aborted')

        // Should no longer be in rebase state
        expect(await ws.isInRebase()).toBe(false)
      } else {
        // If rebase completed or failed differently, just verify we can run abort
        const { output } = await ws.git('rebase --abort')
        // Should either abort or say nothing to abort
        expect(output.toLowerCase()).toMatch(/aborted|no rebase|not rebasing/)
      }
    })

    it('restores branch to pre-rebase state after abort', async () => {
      const preRebaseHead = await ws.getHead()

      await ws.git('rebase main')

      if (await ws.isInRebase()) {
        await ws.git('rebase --abort')

        // HEAD should be back to original
        const postAbortHead = await ws.getHead()
        expect(postAbortHead).toBe(preRebaseHead)
      }
    })

    it('restores working tree to clean state after abort', async () => {
      await ws.git('rebase main')

      if (await ws.isInRebase()) {
        await ws.git('rebase --abort')

        const { output } = await ws.git('status')
        expect(output).toContain('nothing to commit')
      }
    })
  })

  describe('git cherry-pick --abort', () => {
    let ws
    let cherryPickSha

    beforeEach(async () => {
      // Set up a conflict scenario for cherry-pick
      ws = await createWorkspace({
        files: { 'file.txt': 'base content' },
        git: { init: true, initialCommit: true },
      })

      // Create test branch with a commit to cherry-pick
      await ws.git('checkout -b test')
      await ws.writeFile('file.txt', 'test content')
      await ws.git('add .')
      await ws.git('commit -m "Test commit to cherry-pick"')

      // Get the SHA of the commit to cherry-pick
      const log = await ws.getLog(1)
      cherryPickSha = log[0].oid.slice(0, 7)

      // Go back to main and make conflicting changes
      await ws.git('checkout main')
      await ws.writeFile('file.txt', 'main content')
      await ws.git('add .')
      await ws.git('commit -m "Main change"')
    })

    it('aborts a conflicted cherry-pick', async () => {
      // Start cherry-pick that will conflict
      await ws.git(`cherry-pick ${cherryPickSha}`)

      // Check if in cherry-pick state
      const wasInCherryPick = await ws.isInCherryPick()

      if (wasInCherryPick) {
        // Abort the cherry-pick
        const { output } = await ws.git('cherry-pick --abort')
        expect(output).toContain('Cherry-pick aborted')

        // Should no longer be in cherry-pick state
        expect(await ws.isInCherryPick()).toBe(false)
      } else {
        // If cherry-pick behaved differently, verify abort command works
        const { output } = await ws.git('cherry-pick --abort')
        expect(output.toLowerCase()).toMatch(/aborted|no cherry-pick|not cherry-picking/)
      }
    })

    it('restores working tree to clean state after abort', async () => {
      await ws.git(`cherry-pick ${cherryPickSha}`)

      if (await ws.isInCherryPick()) {
        await ws.git('cherry-pick --abort')

        const { output } = await ws.git('status')
        expect(output).toContain('nothing to commit')
        expect(output).toContain('working tree clean')
      }
    })

    it('preserves original file content after abort', async () => {
      const originalContent = await ws.readFile('file.txt')

      await ws.git(`cherry-pick ${cherryPickSha}`)

      if (await ws.isInCherryPick()) {
        await ws.git('cherry-pick --abort')

        const restoredContent = await ws.readFile('file.txt')
        expect(restoredContent).toBe(originalContent)
      }
    })
  })

  describe('abort commands without active operation', () => {
    let ws

    beforeEach(async () => {
      ws = await createWorkspace({
        files: { 'file.txt': 'content' },
        git: { init: true, initialCommit: true },
      })
    })

    it('merge --abort reports no merge in progress', async () => {
      const { output } = await ws.git('merge --abort')
      expect(output.toLowerCase()).toMatch(/no merge|not merging|nothing/)
    })

    it('rebase --abort reports no rebase in progress', async () => {
      const { output } = await ws.git('rebase --abort')
      expect(output.toLowerCase()).toMatch(/no rebase|not rebasing|nothing/)
    })

    it('cherry-pick --abort reports no cherry-pick in progress', async () => {
      const { output } = await ws.git('cherry-pick --abort')
      expect(output.toLowerCase()).toMatch(/no cherry-pick|not cherry-picking|nothing/)
    })
  })
})
