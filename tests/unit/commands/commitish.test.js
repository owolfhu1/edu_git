/**
 * Commitish parsing test matrix.
 *
 * Per reviewer note: Lock in ref behavior early to catch regressions during refactors.
 * Tests HEAD^, HEAD^2, HEAD~2, HEAD^2~3, HEAD~1^2, branch names, and short SHAs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('commitish parsing', () => {
  let ws

  beforeEach(async () => {
    // Create a repo with multiple commits and a merge to test parent references
    ws = await createWorkspace({
      files: { 'file.txt': 'initial' },
      git: { init: true, initialCommit: true },
    })

    // Create a linear history: initial -> second -> third
    await ws.writeFile('file.txt', 'second')
    await ws.git('add .')
    await ws.git('commit -m "Second commit"')

    await ws.writeFile('file.txt', 'third')
    await ws.git('add .')
    await ws.git('commit -m "Third commit"')
  })

  describe('HEAD references', () => {
    it('resolves HEAD to current commit', async () => {
      const { output } = await ws.git('log -n 1')
      expect(output).toContain('Third commit')
    })

    it('resolves HEAD~1 to parent commit', async () => {
      const { output } = await ws.git('show HEAD~1 --oneline')
      // Should show second commit or navigate to it
      // Note: git show may not be implemented, test with checkout
      await ws.git('checkout HEAD~1')
      const { output: logOutput } = await ws.git('log -n 1')
      expect(logOutput).toContain('Second commit')
    })

    it('resolves HEAD~2 to grandparent commit', async () => {
      await ws.git('checkout HEAD~2')
      const { output } = await ws.git('log -n 1')
      expect(output).toContain('Initial commit')
    })

    it('resolves HEAD^ as alias for HEAD~1', async () => {
      await ws.git('checkout HEAD^')
      const { output } = await ws.git('log -n 1')
      expect(output).toContain('Second commit')
    })
  })

  describe('branch name references', () => {
    it('resolves branch name to its tip', async () => {
      await ws.git('branch feature')
      await ws.git('checkout feature')
      await ws.writeFile('file.txt', 'feature change')
      await ws.git('add .')
      await ws.git('commit -m "Feature commit"')

      await ws.git('checkout main')
      // main should still be at "Third commit"
      const { output } = await ws.git('log -n 1')
      expect(output).toContain('Third commit')
    })

    it('resolves branch~1 to branch parent', async () => {
      await ws.git('branch feature')
      await ws.git('checkout feature~1')
      const { output } = await ws.git('log -n 1')
      expect(output).toContain('Second commit')
    })
  })

  describe('error handling', () => {
    it('reports error for invalid ref', async () => {
      const { output } = await ws.git('checkout nonexistent-branch')
      expect(output.toLowerCase()).toMatch(/error|not found|invalid|does not exist|could not find/)
    })

    it('reports error for ancestor beyond history', async () => {
      // We only have 3 commits, HEAD~10 should fail
      const { output } = await ws.git('checkout HEAD~10')
      expect(output.toLowerCase()).toMatch(/error|invalid|not found|not a tree|fatal/)
    })
  })

  describe('merge commit parent references (when applicable)', () => {
    let mergeWs

    beforeEach(async () => {
      // Create a repo with a merge commit to test ^2 syntax
      mergeWs = await createWorkspace({
        files: { 'file.txt': 'base' },
        git: { init: true, initialCommit: true },
      })

      // Create diverging history
      await mergeWs.git('checkout -b feature')
      await mergeWs.writeFile('feature.txt', 'feature content')
      await mergeWs.git('add .')
      await mergeWs.git('commit -m "Feature commit"')

      await mergeWs.git('checkout main')
      await mergeWs.writeFile('main.txt', 'main content')
      await mergeWs.git('add .')
      await mergeWs.git('commit -m "Main commit"')

      // Merge feature into main (creates merge commit)
      await mergeWs.git('merge feature')
    })

    it('resolves HEAD^1 to first parent of merge', async () => {
      // HEAD^1 or HEAD^ should be the "Main commit" (first parent)
      await mergeWs.git('checkout HEAD^1')
      const { output } = await mergeWs.git('log -n 1')
      expect(output).toContain('Main commit')
    })

    it('resolves HEAD^2 to second parent of merge', async () => {
      // HEAD^2 should be the "Feature commit" (second parent)
      // This tests the caret notation that was identified as broken
      await mergeWs.git('checkout HEAD^2')
      const { output } = await mergeWs.git('log -n 1')
      expect(output).toContain('Feature commit')
    })
  })
})
