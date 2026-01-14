import coreCommands from './core'
import gitCommand from './git'

const createCommands = () => ({
  ...coreCommands,
  git: gitCommand,
})

export { createCommands }
