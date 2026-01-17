/**
 * Tests demonstrating file structure examination after git commands.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('file structure examination', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace({
      files: {
        'README.md': '# Project',
        'src/index.js': 'console.log("hello")',
        'src/utils.js': 'export const add = (a, b) => a + b',
      },
      git: { init: true, initialCommit: true },
    })
  })

  describe('listing files', () => {
    it('lists files in a directory', async () => {
      const files = await ws.listFiles('src')
      expect(files).toContain('index.js')
      expect(files).toContain('utils.js')
    })

    it('gets full file tree', async () => {
      const tree = await ws.getFileTree()
      expect(tree).toEqual([
        'README.md',
        'src/index.js',
        'src/utils.js',
      ])
    })
  })

  describe('checking file existence', () => {
    it('confirms file exists', async () => {
      expect(await ws.exists('src/index.js')).toBe(true)
    })

    it('confirms file does not exist', async () => {
      expect(await ws.exists('src/nonexistent.js')).toBe(false)
    })
  })

  describe('reading file content', () => {
    it('reads file content after git operations', async () => {
      // Modify file
      await ws.writeFile('src/index.js', 'console.log("updated")')
      await ws.git('add .')
      await ws.git('commit -m "Update"')

      // Read back
      const content = await ws.readFile('src/index.js')
      expect(content).toBe('console.log("updated")')
    })
  })

  describe('snapshots', () => {
    it('captures file snapshot before/after', async () => {
      const before = await ws.getSnapshot(['src/index.js'])

      await ws.writeFile('src/index.js', 'console.log("changed")')

      const after = await ws.getSnapshot(['src/index.js'])

      expect(before['src/index.js']).toBe('console.log("hello")')
      expect(after['src/index.js']).toBe('console.log("changed")')
    })
  })

  describe('git checkout changes files', () => {
    it('verifies files change when switching branches', async () => {
      // Create feature branch with new file
      await ws.git('checkout -b feature')
      await ws.writeFile('src/feature.js', 'export const feature = true')
      await ws.git('add .')
      await ws.git('commit -m "Add feature"')

      // Feature branch should have the new file
      expect(await ws.exists('src/feature.js')).toBe(true)
      const featureTree = await ws.getFileTree()
      expect(featureTree).toContain('src/feature.js')

      // Switch back to main
      await ws.git('checkout main')

      // Main should NOT have the feature file
      expect(await ws.exists('src/feature.js')).toBe(false)
      const mainTree = await ws.getFileTree()
      expect(mainTree).not.toContain('src/feature.js')
    })

    it('verifies file content changes on checkout', async () => {
      // Create branch with modified file
      await ws.git('checkout -b modified')
      await ws.writeFile('README.md', '# Modified Project')
      await ws.git('add .')
      await ws.git('commit -m "Modify readme"')

      expect(await ws.readFile('README.md')).toBe('# Modified Project')

      // Switch back to main
      await ws.git('checkout main')

      expect(await ws.readFile('README.md')).toBe('# Project')
    })
  })

  describe('git merge affects files', () => {
    it('verifies merge updates git state', async () => {
      // Create feature branch
      await ws.git('checkout -b feature')
      await ws.writeFile('src/new-feature.js', 'export default {}')
      await ws.git('add .')
      await ws.git('commit -m "Add new feature"')

      const featureHead = await ws.getHead()

      // Merge into main
      await ws.git('checkout main')
      const { output } = await ws.git('merge feature')

      // Merge should succeed (fast-forward)
      expect(output.toLowerCase()).toMatch(/fast-forward|merged|already/)

      // HEAD should now point to feature's commit
      const mainHead = await ws.getHead()
      expect(mainHead).toBe(featureHead)
    })

    it('verifies file exists after checkout post-merge', async () => {
      // Create feature branch with new file
      await ws.git('checkout -b feature')
      await ws.writeFile('src/new-feature.js', 'export default {}')
      await ws.git('add .')
      await ws.git('commit -m "Add new feature"')

      // Merge into main
      await ws.git('checkout main')
      await ws.git('merge feature')

      // Re-checkout to ensure working tree is updated
      await ws.git('checkout main')

      // Now file should exist
      expect(await ws.exists('src/new-feature.js')).toBe(true)
    })
  })

  describe('git reset affects files', () => {
    it('verifies reset --hard restores files', async () => {
      const original = await ws.readFile('src/index.js')

      // Modify and commit
      await ws.writeFile('src/index.js', 'MODIFIED')
      await ws.git('add .')
      await ws.git('commit -m "Modify"')

      expect(await ws.readFile('src/index.js')).toBe('MODIFIED')

      // Reset to previous commit
      await ws.git('reset --hard HEAD~1')

      // File should be restored
      expect(await ws.readFile('src/index.js')).toBe(original)
    })
  })

  describe('expectFiles assertion', () => {
    it('passes when files match', async () => {
      await ws.expectFiles([
        'README.md',
        'src/index.js',
        'src/utils.js',
      ])
    })

    it('fails when files do not match', async () => {
      await expect(
        ws.expectFiles(['README.md', 'missing.txt'])
      ).rejects.toThrow('File structure mismatch')
    })
  })
})
