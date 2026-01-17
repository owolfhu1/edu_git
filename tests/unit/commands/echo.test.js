import { describe, it, expect, beforeEach } from 'vitest'
import { createWorkspace } from '../../harness/GitTestWorkspace.js'

describe('echo command', () => {
  let ws

  beforeEach(async () => {
    ws = await createWorkspace()
  })

  it('prints text to the terminal output', async () => {
    const { output } = await ws.run('echo hello world')
    expect(output).toContain('hello world')
  })

  it('creates a file with redirected output', async () => {
    await ws.run('echo "base content" > file.txt')
    const content = await ws.readFile('/file.txt')
    expect(content).toBe('base content\n')
  })

  it('appends output when using >>', async () => {
    await ws.run('echo "first" > file.txt')
    await ws.run('echo "second" >> file.txt')
    const content = await ws.readFile('/file.txt')
    expect(content).toBe('first\nsecond\n')
  })

  it('errors when redirect is missing a target file', async () => {
    const { output } = await ws.run('echo "oops" >')
    expect(output).toContain('echo: missing file operand')
  })
})
