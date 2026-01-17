/**
 * Tests for git cherry-pick command.
 * Migrated from cypress/e2e/cherry_pick.cy.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git cherry-pick', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'initial content',
        'docs/readme.txt': 'readme content',
      },
      git: { init: true, initialCommit: true },
    })
  })

  describe('basic cherry-pick', () => {
    it('cherry-picks a commit from a feature branch', async () => {
      // Create feature branch with a commit
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'cherry pick content')
      await ws.git('add .')
      await ws.git('commit -m "cherry change"')

      // Get the commit SHA
      const featureHead = await ws.getHead()
      const shortSha = featureHead.slice(0, 7)

      // Switch back to main
      await ws.git('checkout main')

      // Cherry-pick the commit
      await ws.git(`cherry-pick ${shortSha}`)

      // Verify the commit was applied
      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('cherry change')

      // Verify file content
      const content = await ws.readFile('src/index.txt')
      expect(content).toBe('cherry pick content')

      // Working tree should be clean
      expect(await ws.isClean()).toBe(true)
    })

    it('cherry-picks using full SHA', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'full sha content')
      await ws.git('add .')
      await ws.git('commit -m "full sha commit"')

      const fullSha = await ws.getHead()

      await ws.git('checkout main')
      await ws.git(`cherry-pick ${fullSha}`)

      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('full sha commit')
    })
  })

  describe('cherry-pick conflicts', () => {
    it('detects and marks conflicts during cherry-pick', async () => {
      // Create feature branch with conflicting change
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature version')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      const featureHead = await ws.getHead()

      // Make conflicting change on main
      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main version')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      // Cherry-pick should create conflict
      await ws.git(`cherry-pick ${featureHead.slice(0, 7)}`)

      // Should be in cherry-pick state
      expect(await ws.isInCherryPick()).toBe(true)

      // File should have conflict markers
      const content = await ws.readFile('src/index.txt')
      expect(content).toContain('<<<<<<<')
      expect(content).toContain('=======')
      expect(content).toContain('>>>>>>>')
    })

    it('continues cherry-pick after resolving conflict', async () => {
      // Setup conflict scenario
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature version')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      const featureHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main version')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git(`cherry-pick ${featureHead.slice(0, 7)}`)

      // Resolve conflict
      await ws.writeFile('src/index.txt', 'resolved content')
      await ws.git('add .')
      await ws.git('cherry-pick --continue')

      // Should no longer be in cherry-pick state
      expect(await ws.isInCherryPick()).toBe(false)

      // Commit should be applied
      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('feature change')
    })

    it('aborts cherry-pick when requested', async () => {
      // Setup conflict scenario
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature version')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      const featureHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main version')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      const mainHead = await ws.getHead()

      await ws.git(`cherry-pick ${featureHead.slice(0, 7)}`)

      // Abort
      await ws.git('cherry-pick --abort')

      // Should not be in cherry-pick state
      expect(await ws.isInCherryPick()).toBe(false)

      // HEAD should be back at main commit
      expect(await ws.getHead()).toBe(mainHead)
    })
  })

  describe('cherry-pick merge commits', () => {
    it('cherry-picks a merge commit with -m 1', async () => {
      await ws.writeFile('main.txt', 'main base')
      await ws.git('add .')
      await ws.git('commit -m "main base"')

      await ws.git('checkout -b feature')
      await ws.writeFile('feature.txt', 'feature change')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      await ws.git('checkout main')
      await ws.writeFile('main.txt', 'main change')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git('merge feature')
      const mergeSha = await ws.getHead()

      await ws.git('checkout HEAD~2')
      await ws.git('checkout -b other')

      const { output } = await ws.git(`cherry-pick -m 1 ${mergeSha}`)
      expect(output.toLowerCase()).toMatch(/cherry-pick|applied|merged|commit|\[/)

      const featureContent = await ws.readFile('feature.txt')
      expect(featureContent).toBe('feature change')
    })
  })

  describe('rev-parse', () => {
    it('returns full SHA with rev-parse HEAD', async () => {
      const { output } = await ws.git('rev-parse HEAD')
      expect(output.trim()).toMatch(/^[0-9a-f]{40}$/i)
    })

    it('returns short SHA with --short', async () => {
      const { output } = await ws.git('rev-parse --short HEAD')
      expect(output.trim()).toMatch(/^[0-9a-f]{7}$/i)
    })
  })
})
