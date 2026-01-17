/**
 * Tests for git merge and rebase commands.
 * Migrated from cypress/e2e/git_cheat_sheet_commands.cy.js (partial)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'
import git from 'isomorphic-git'

describe('git merge and rebase', () => {
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

  describe('git merge', () => {
    it('fast-forwards when possible', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature content')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      const featureHead = await ws.getHead()

      await ws.git('checkout main')
      const { output } = await ws.git('merge feature')

      expect(output.toLowerCase()).toMatch(/fast-forward|merged/)

      // HEAD should now be at feature commit
      expect(await ws.getHead()).toBe(featureHead)
    })

    it('creates merge commit for diverged branches', async () => {
      // Create feature branch
      await ws.git('checkout -b feature')
      await ws.writeFile('docs/readme.txt', 'feature readme')
      await ws.git('add .')
      await ws.git('commit -m "feature readme"')

      // Make a different change on main
      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main content')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      // Merge feature into main
      await ws.git('merge feature')

      // Log should contain the merge
      const { output } = await ws.git('log')
      expect(output).toContain('Merge')
    })

    it('reports success message', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature content')
      await ws.git('add .')
      await ws.git('commit -m "feature"')

      await ws.git('checkout main')
      const { output } = await ws.git('merge feature')

      expect(output.toLowerCase()).toMatch(/merged|fast-forward|already/)
    })
  })

  describe('git rebase', () => {
    it('rebases a branch onto another', async () => {
      // Create feature branch
      await ws.git('checkout -b feature')
      await ws.writeFile('docs/readme.txt', 'feature readme')
      await ws.git('add .')
      await ws.git('commit -m "feature readme"')

      // Make a change on main
      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main content')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      // Rebase feature onto main (no conflict expected - different files)
      await ws.git('checkout feature')
      const { output } = await ws.git('rebase main')

      expect(output.toLowerCase()).toMatch(/rebased|updated/)
    })

    it('detects conflict during rebase', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature line')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main line')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git('checkout feature')
      const { output } = await ws.git('rebase main')

      // Output should mention conflicts or rebase failure
      expect(output.toLowerCase()).toMatch(/conflict|fix|failed|rebase/)

      // File should have conflict markers
      const content = await ws.readFile('src/index.txt')
      expect(content).toContain('<<<<<<<')
    })

    it('continues rebase after conflict resolution', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature line')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main line')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git('checkout feature')
      await ws.git('rebase main')

      // Resolve conflict
      await ws.writeFile('src/index.txt', 'resolved content')
      await ws.git('add .')
      const { output } = await ws.git('rebase --continue')

      expect(output).toContain('Successfully rebased')
      expect(await ws.isInRebase()).toBe(false)
    })

    it('blocks rebase --continue if conflict file changes after staging', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature line')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main line')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git('checkout feature')
      await ws.git('rebase main')

      // Resolve conflict and stage it.
      await ws.writeFile('src/index.txt', 'resolved content')
      await ws.git('add .')

      const originalCommit = git.commit
      let injected = false
      const spy = vi.spyOn(git, 'commit').mockImplementation(async (...args) => {
        if (!injected) {
          injected = true
          await ws.writeFile('src/index.txt', 'changed after staging')
        }
        return originalCommit(...args)
      })

      const { output } = await ws.git('rebase --continue')
      spy.mockRestore()

      expect(output.toLowerCase()).toContain('fatal')
      expect(output.toLowerCase()).toContain('fix conflicts')
      expect(await ws.isInRebase()).toBe(true)
    })

    it('aborts rebase when requested', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature line')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      const featureHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main line')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      await ws.git('checkout feature')
      await ws.git('rebase main')

      await ws.git('rebase --abort')

      expect(await ws.isInRebase()).toBe(false)
      expect(await ws.getHead()).toBe(featureHead)
    })
  })

  describe('detached HEAD', () => {
    it('checkout HEAD~1 results in detached HEAD', async () => {
      await ws.writeFile('src/index.txt', 'commit 1')
      await ws.git('add .')
      await ws.git('commit -m "commit 1"')

      await ws.writeFile('src/index.txt', 'commit 2')
      await ws.git('add .')
      await ws.git('commit -m "commit 2"')

      await ws.git('checkout HEAD~1')
      const { output } = await ws.git('status')

      expect(output).toContain('HEAD detached')
    })

    it('checkout HEAD^ results in detached HEAD', async () => {
      await ws.writeFile('src/index.txt', 'parent')
      await ws.git('add .')
      await ws.git('commit -m "parent"')

      await ws.writeFile('src/index.txt', 'child')
      await ws.git('add .')
      await ws.git('commit -m "child"')

      await ws.git('checkout HEAD^')
      const { output } = await ws.git('status')

      expect(output).toContain('HEAD detached')
    })

    it('checkout by SHA results in detached HEAD', async () => {
      await ws.writeFile('src/index.txt', 'commit')
      await ws.git('add .')
      await ws.git('commit -m "commit"')

      const head = await ws.getHead()

      await ws.writeFile('src/index.txt', 'next')
      await ws.git('add .')
      await ws.git('commit -m "next"')

      await ws.git(`checkout ${head.slice(0, 7)}`)
      const { output } = await ws.git('status')

      expect(output).toContain('HEAD detached')
    })
  })
})
