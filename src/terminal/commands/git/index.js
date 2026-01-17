import { registry } from './registry'
import { runMiddleware } from './middleware'
import legacyGitCommand from '../git.legacy'

// Import handlers to register them
import './handlers/init'
import './handlers/status'
import './handlers/add'

const gitCommand = async (args, context) => {
  const subcommand = args[0]

  // Check if we have a registered handler for this subcommand
  const command = registry.get(subcommand)

  if (command) {
    // Run through middleware chain
    const handlerArgs = args.slice(1)
    const ctx = await runMiddleware(command.middleware, handlerArgs, context)

    // Middleware can return null to abort (e.g., requireRepo when not in a repo)
    if (ctx === null) {
      return
    }

    // Execute the handler
    await command.handler(handlerArgs, ctx)
    return
  }

  // Fall back to legacy handler for unmigrated commands
  await legacyGitCommand(args, context)
}

export default gitCommand
