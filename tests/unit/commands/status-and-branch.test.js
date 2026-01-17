/**
 * Tests for git status, branch, and log commands.
 * Migrated from cypress/e2e/git_commands.cy.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git status and branch commands', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'hello world',
        'docs/readme.txt': 'documentation',
      },
      git: { init: true, initialCommit: true, initialMessage: 'init commit' },
    })
  })

  describe('git status', () => {
    it('shows current branch name', async () => {
      const { output } = await ws.git('status')
      expect(output).toContain('On branch main')
    })

    it('shows clean working tree when no changes', async () => {
      const { output } = await ws.git('status')
      expect(output).toContain('nothing to commit')
    })

    it('shows untracked files', async () => {
      await ws.writeFile('new-file.txt', 'new content')
      const { output } = await ws.git('status')
      expect(output).toMatch(/untracked|new-file\.txt/i)
    })

    it('shows staged files', async () => {
      await ws.writeFile('src/index.txt', 'modified')
      await ws.git('add src/index.txt')
      const { output } = await ws.git('status')
      expect(output).toContain('Changes to be committed')
    })

    it('shows unstaged modifications', async () => {
      await ws.writeFile('src/index.txt', 'modified')
      const { output } = await ws.git('status')
      expect(output).toContain('Changes not staged for commit')
    })
  })

  describe('git branch', () => {
    it('lists main branch', async () => {
      const { output } = await ws.git('branch')
      expect(output).toContain('main')
    })

    it('shows current branch with asterisk', async () => {
      const { output } = await ws.git('branch')
      expect(output).toMatch(/\*\s*main/)
    })

    it('creates a new branch', async () => {
      await ws.git('branch feature')
      const { output } = await ws.git('branch')
      expect(output).toContain('feature')
      expect(output).toContain('main')
    })

    it('deletes a branch with -d', async () => {
      await ws.git('branch feature')
      await ws.git('branch -d feature')
      const { output } = await ws.git('branch')
      expect(output).not.toContain('feature')
    })

    it('deletes a branch with -D (force)', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature change')
      await ws.git('add .')
      await ws.git('commit -m "feature commit"')
      await ws.git('checkout main')
      await ws.git('branch -D feature')
      const { output } = await ws.git('branch')
      expect(output).not.toContain('feature')
    })
  })

  describe('git checkout', () => {
    it('switches to an existing branch', async () => {
      await ws.git('branch feature')
      await ws.git('checkout feature')
      const { output } = await ws.git('status')
      expect(output).toContain('On branch feature')
    })

    it('creates and switches to a new branch with -b', async () => {
      await ws.git('checkout -b feature')
      const { output } = await ws.git('status')
      expect(output).toContain('On branch feature')
    })

    it('reports error for non-existent branch', async () => {
      const { output } = await ws.git('checkout nonexistent')
      expect(output.toLowerCase()).toMatch(/error|not found|invalid|does not exist|could not find|fatal/)
    })
  })

  describe('git switch', () => {
    it('switches to an existing branch', async () => {
      await ws.git('branch feature')
      await ws.git('switch feature')
      const { output } = await ws.git('status')
      expect(output).toContain('On branch feature')
    })

    it('creates and switches with -c', async () => {
      await ws.git('switch -c feature')
      const { output } = await ws.git('status')
      expect(output).toContain('On branch feature')
    })
  })

  describe('git log', () => {
    it('shows commit history', async () => {
      const { output } = await ws.git('log')
      expect(output).toContain('init commit')
    })

    it('shows log with --oneline', async () => {
      const { output } = await ws.git('log --oneline')
      expect(output).toContain('init commit')
    })

    it('limits commits with -n', async () => {
      await ws.writeFile('src/index.txt', 'second')
      await ws.git('add .')
      await ws.git('commit -m "second commit"')
      await ws.writeFile('src/index.txt', 'third')
      await ws.git('add .')
      await ws.git('commit -m "third commit"')

      const { output } = await ws.git('log --oneline -n 1')
      expect(output).toContain('third commit')
      expect(output).not.toContain('second commit')
    })
  })

  describe('branch-specific content', () => {
    it('files change when switching branches', async () => {
      const original = await ws.readFile('src/index.txt')

      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature content')
      await ws.git('add .')
      await ws.git('commit -m "feature change"')

      expect(await ws.readFile('src/index.txt')).toBe('feature content')

      await ws.git('checkout main')
      expect(await ws.readFile('src/index.txt')).toBe(original)

      await ws.git('checkout feature')
      expect(await ws.readFile('src/index.txt')).toBe('feature content')
    })

    it('branch commit history is independent', async () => {
      await ws.git('checkout -b feature')
      await ws.writeFile('src/index.txt', 'feature content')
      await ws.git('add .')
      await ws.git('commit -m "feature commit"')

      const { output: featureLog } = await ws.git('log --oneline -n 1')
      expect(featureLog).toContain('feature commit')

      await ws.git('checkout main')
      const { output: mainLog } = await ws.git('log --oneline -n 1')
      expect(mainLog).toContain('init commit')
    })
  })
})
