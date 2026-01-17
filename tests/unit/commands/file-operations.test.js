/**
 * Tests for git file operations (mv, rm, add).
 * Migrated from cypress/e2e/git_cheat_sheet_commands.cy.js (partial)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('git file operations', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'src/index.txt': 'initial content',
        'docs/readme.txt': 'readme content',
        'docs/setup.txt': 'setup content',
      },
      git: { init: true, initialCommit: true },
    })
  })

  describe('git add', () => {
    it('stages a single file', async () => {
      await ws.writeFile('src/index.txt', 'modified')
      await ws.git('add src/index.txt')

      const { output } = await ws.git('status')
      expect(output).toContain('Changes to be committed')
    })

    it('stages all files with .', async () => {
      await ws.writeFile('src/index.txt', 'modified')
      await ws.writeFile('docs/readme.txt', 'modified')
      await ws.git('add .')

      const { output } = await ws.git('diff --staged')
      expect(output).toContain('src/index.txt')
      expect(output).toContain('docs/readme.txt')
    })

    it('stages new files', async () => {
      await ws.writeFile('new-file.txt', 'new content')
      await ws.git('add new-file.txt')

      const { output } = await ws.git('status')
      expect(output).toContain('new file')
    })
  })

  describe('git mv', () => {
    it('renames a file', async () => {
      await ws.git('mv docs/readme.txt docs/README.txt')

      expect(await ws.exists('docs/readme.txt')).toBe(false)
      expect(await ws.exists('docs/README.txt')).toBe(true)
    })

    it('moves a file to a different directory', async () => {
      await ws.git('mv docs/setup.txt src/setup.txt')

      expect(await ws.exists('docs/setup.txt')).toBe(false)
      expect(await ws.exists('src/setup.txt')).toBe(true)

      const content = await ws.readFile('src/setup.txt')
      expect(content).toBe('setup content')
    })

    it('stages the move', async () => {
      await ws.git('mv docs/readme.txt docs/README.txt')

      const { output } = await ws.git('status')
      // Status should show either 'renamed' or separate 'deleted' and 'new file'
      expect(output).toMatch(/renamed|deleted|new file|Changes to be committed/)
    })
  })

  describe('git rm', () => {
    it('removes a file from working tree and stages deletion', async () => {
      await ws.git('rm docs/setup.txt')

      expect(await ws.exists('docs/setup.txt')).toBe(false)

      const { output } = await ws.git('diff --staged')
      expect(output).toContain('docs/setup.txt')
    })

    it('stages deletion for commit', async () => {
      await ws.git('rm docs/readme.txt')
      await ws.git('commit -m "remove readme"')

      expect(await ws.exists('docs/readme.txt')).toBe(false)
    })
  })

  describe('touch command', () => {
    it('creates a new empty file', async () => {
      await ws.run('touch new-file.txt')
      expect(await ws.exists('new-file.txt')).toBe(true)
    })

    it('creates file in subdirectory', async () => {
      await ws.run('touch docs/new-doc.txt')
      expect(await ws.exists('docs/new-doc.txt')).toBe(true)
    })
  })

  describe('combined file operations', () => {
    it('handles add, mv, rm workflow', async () => {
      // Create new file
      await ws.writeFile('docs/ops.txt', 'ops content')
      await ws.git('add docs/ops.txt')
      await ws.git('commit -m "add ops file"')

      expect(await ws.exists('docs/ops.txt')).toBe(true)

      // Rename file
      await ws.git('mv docs/ops.txt docs/ops_renamed.txt')
      await ws.git('commit -m "rename ops file"')

      expect(await ws.exists('docs/ops.txt')).toBe(false)
      expect(await ws.exists('docs/ops_renamed.txt')).toBe(true)

      // Remove file
      await ws.git('rm docs/ops_renamed.txt')

      const { output } = await ws.git('diff --staged')
      expect(output).toContain('docs/ops_renamed.txt')
    })
  })
})
