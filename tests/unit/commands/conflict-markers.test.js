/**
 * Tests for conflict marker generation.
 * Migrated from cypress/e2e/conflict_markers.cy.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('conflict marker workflows', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'initial content',
        'docs/overview.txt': 'overview content',
        'notes/ideas.txt': 'ideas content',
        'src/components/App.txt': 'app content',
      },
      git: { init: true, initialCommit: true },
    })
  })

  const assertConflictMarkers = (content) => {
    expect(content).toContain('<<<<<<<')
    expect(content).toContain('=======')
    expect(content).toContain('>>>>>>>')

    const lines = content.split('\n')
    expect(lines.some((line) => line.trim().startsWith('<<<<<<<'))).toBe(true)
    expect(lines.some((line) => line.trim().startsWith('======='))).toBe(true)
    expect(lines.some((line) => line.trim().startsWith('>>>>>>>'))).toBe(true)
  }

  describe('merge conflicts', () => {
    it('shows conflict markers for merge conflicts (src/index.txt)', async () => {
      // Create diverging branches
      await ws.git('checkout -b conflict_branch')
      await ws.writeFile('src/index.txt', 'initial content\nBranch merge line')
      await ws.git('add .')
      await ws.git('commit -m "branch conflict change"')

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'initial content\nBase merge line')
      await ws.git('add .')
      await ws.git('commit -m "base conflict change"')

      await ws.git('checkout conflict_branch')
      await ws.git('merge main')

      const content = await ws.readFile('src/index.txt')
      assertConflictMarkers(content)
    })

    it('shows conflict markers for merge conflicts (docs/overview.txt)', async () => {
      await ws.git('checkout -b conflict_branch')
      await ws.writeFile('docs/overview.txt', 'overview content\nBranch overview line')
      await ws.git('add .')
      await ws.git('commit -m "branch conflict change"')

      await ws.git('checkout main')
      await ws.writeFile('docs/overview.txt', 'overview content\nBase overview line')
      await ws.git('add .')
      await ws.git('commit -m "base conflict change"')

      await ws.git('checkout conflict_branch')
      await ws.git('merge main')

      const content = await ws.readFile('docs/overview.txt')
      assertConflictMarkers(content)
    })

    it('enters merge state on conflict', async () => {
      await ws.setupConflict(
        'src/index.txt',
        'base content',
        'our content',
        'their content'
      )

      await ws.git('merge theirs')

      expect(await ws.isInMerge()).toBe(true)
    })
  })

  describe('cherry-pick conflicts', () => {
    it('shows conflict markers for cherry-pick conflicts (notes/ideas.txt)', async () => {
      await ws.git('checkout -b conflict_branch')
      await ws.writeFile('notes/ideas.txt', 'ideas content\nBranch ideas line')
      await ws.git('add .')
      await ws.git('commit -m "branch conflict change"')

      const branchHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('notes/ideas.txt', 'ideas content\nBase ideas line')
      await ws.git('add .')
      await ws.git('commit -m "base conflict change"')

      await ws.git(`cherry-pick ${branchHead.slice(0, 7)}`)

      const content = await ws.readFile('notes/ideas.txt')
      assertConflictMarkers(content)
    })

    it('shows conflict markers for cherry-pick conflicts (src/components/App.txt)', async () => {
      await ws.git('checkout -b conflict_branch')
      await ws.writeFile('src/components/App.txt', 'app content\nBranch app line')
      await ws.git('add .')
      await ws.git('commit -m "branch conflict change"')

      const branchHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('src/components/App.txt', 'app content\nBase app line')
      await ws.git('add .')
      await ws.git('commit -m "base conflict change"')

      await ws.git(`cherry-pick ${branchHead.slice(0, 7)}`)

      const content = await ws.readFile('src/components/App.txt')
      assertConflictMarkers(content)
    })

    it('enters cherry-pick state on conflict', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature version')
      await ws.git('add .')
      await ws.git('commit -m "feature"')

      const featureHead = await ws.getHead()

      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main version')
      await ws.git('add .')
      await ws.git('commit -m "main"')

      await ws.git(`cherry-pick ${featureHead.slice(0, 7)}`)

      expect(await ws.isInCherryPick()).toBe(true)
    })
  })

  describe('stash apply conflicts', () => {
    it('shows conflict markers for stash apply conflicts (docs/overview.txt)', async () => {
      // Stash some changes
      await ws.writeFile('docs/overview.txt', 'overview content\nStash overview line')
      await ws.git('stash -m "stash conflict"')

      // Make conflicting changes
      await ws.writeFile('docs/overview.txt', 'overview content\nCurrent overview line')

      // Apply stash (should create conflict)
      await ws.git('stash apply')

      const content = await ws.readFile('docs/overview.txt')
      assertConflictMarkers(content)
    })
  })

  describe('rebase conflicts', () => {
    it('shows conflict markers during rebase', async () => {
      // Create feature branch
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature line')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      // Create conflicting change on main
      await ws.git('checkout main')
      await ws.writeFile('src/index.txt', 'main line')
      await ws.git('add .')
      await ws.git('commit -m "main change"')

      // Rebase feature onto main
      await ws.git('checkout feature')
      const { output } = await ws.git('rebase main')

      // Should mention conflict in output
      expect(output.toLowerCase()).toMatch(/conflict|fail|fix/)

      // File should have conflict markers
      const content = await ws.readFile('src/index.txt')
      assertConflictMarkers(content)
    })

    it('continues rebase after resolving conflict', async () => {
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

      // Resolve and continue
      await ws.writeFile('src/index.txt', 'resolved content')
      await ws.git('add .')
      await ws.git('rebase --continue')

      expect(await ws.isInRebase()).toBe(false)
    })
  })
})
