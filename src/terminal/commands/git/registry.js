class CommandRegistry {
  constructor() {
    this.commands = new Map()
  }

  register(name, config) {
    this.commands.set(name, {
      name,
      handler: config.handler,
      middleware: config.middleware || [],
      flags: config.flags || {},
      description: config.description || '',
    })
  }

  get(name) {
    return this.commands.get(name) || null
  }

  has(name) {
    return this.commands.has(name)
  }

  getCompletions(partial) {
    const matches = []
    for (const name of this.commands.keys()) {
      if (name.startsWith(partial)) {
        matches.push(name)
      }
    }
    return matches
  }

  listCommands() {
    return Array.from(this.commands.keys())
  }
}

const registry = new CommandRegistry()

export { CommandRegistry, registry }
