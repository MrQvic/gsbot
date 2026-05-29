const log = require('../lib/logger')

function createCommandRegistry() {
  const commands = new Map()

  function register(definition) {
    if (!definition?.name || typeof definition.run !== 'function') {
      throw new Error('Command must have name and run()')
    }

    const names = [definition.name, ...(definition.aliases || [])]
    for (const name of names) {
      commands.set(name.toLowerCase(), definition)
    }
  }

  function list() {
    const unique = new Set(commands.values())
    return [...unique].sort((a, b) => a.name.localeCompare(b.name))
  }

  async function execute(line, context = {}) {
    const raw = String(line || '').trim()
    if (!raw) return

    const [commandName, ...args] = raw.split(/\s+/)
    const command = commands.get(commandName.toLowerCase())

    const reply = context.reply || ((message) => log.info(message))

    if (!command) {
      reply(`Neznamy prikaz '${commandName}'. Zkus: help`)
      return
    }

    try {
      await command.run({
        ...context,
        args,
        line: raw,
        commandName,
        reply,
        registry: api
      })
    } catch (err) {
      log.error(`Prikaz '${commandName}' spadl: ${err.stack || err.message}`)
      reply(`Chyba: ${err.message}`)
    }
  }

  const api = {
    register,
    list,
    execute
  }

  return api
}

module.exports = {
  createCommandRegistry
}
