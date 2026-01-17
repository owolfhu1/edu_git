const parseArgs = (args, flagDefs = {}) => {
  const flags = {}
  const positional = []
  const errors = []

  // Initialize defaults
  for (const [flag, def] of Object.entries(flagDefs)) {
    if (def.default !== undefined) {
      flags[flag] = def.default
    } else if (def.type === 'boolean') {
      flags[flag] = false
    }
  }

  let index = 0
  while (index < args.length) {
    const arg = args[index]

    // Long flag: --flag or --flag=value
    if (arg.startsWith('--')) {
      const equalIndex = arg.indexOf('=')
      let flagName, value

      if (equalIndex !== -1) {
        flagName = arg.slice(2, equalIndex)
        value = arg.slice(equalIndex + 1)
      } else {
        flagName = arg.slice(2)
        value = undefined
      }

      const def = flagDefs[flagName]
      if (!def) {
        // Unknown flag - store as boolean true for permissive parsing
        flags[flagName] = true
        index += 1
        continue
      }

      if (def.type === 'boolean') {
        flags[flagName] = value !== undefined ? value === 'true' : true
      } else if (def.type === 'string' || def.type === 'number') {
        if (value !== undefined) {
          flags[flagName] = def.type === 'number' ? Number(value) : value
        } else if (index + 1 < args.length && !args[index + 1].startsWith('-')) {
          index += 1
          const nextValue = args[index]
          flags[flagName] = def.type === 'number' ? Number(nextValue) : nextValue
        } else {
          errors.push(`Flag --${flagName} requires a value`)
        }
      }
      index += 1
      continue
    }

    // Short flag: -f or -fvalue or -f value
    if (arg.startsWith('-') && arg.length > 1 && arg[1] !== '-') {
      const shortFlag = arg[1]

      // Find the flag definition by alias
      let matchedFlagName = null
      let matchedDef = null
      for (const [name, def] of Object.entries(flagDefs)) {
        if (def.alias === shortFlag) {
          matchedFlagName = name
          matchedDef = def
          break
        }
      }

      if (!matchedDef) {
        // Unknown short flag - store using the short flag as key
        flags[shortFlag] = true
        index += 1
        continue
      }

      if (matchedDef.type === 'boolean') {
        flags[matchedFlagName] = true
      } else {
        // Value might be attached: -fvalue
        if (arg.length > 2) {
          const value = arg.slice(2)
          flags[matchedFlagName] = matchedDef.type === 'number' ? Number(value) : value
        } else if (index + 1 < args.length && !args[index + 1].startsWith('-')) {
          index += 1
          const value = args[index]
          flags[matchedFlagName] = matchedDef.type === 'number' ? Number(value) : value
        } else {
          errors.push(`Flag -${shortFlag} requires a value`)
        }
      }
      index += 1
      continue
    }

    // Positional argument
    positional.push(arg)
    index += 1
  }

  return { flags, positional, errors }
}

export { parseArgs }
