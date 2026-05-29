const mineflayer = require('mineflayer')

const config = require('./src/config')
const log = require('./src/lib/logger')
const { createCommandRegistry } = require('./src/commands/registry')
const { registerGeneralCommands } = require('./src/commands/general')
const { registerBotEvents } = require('./src/events')
const { startConsole } = require('./src/console')

const bot = mineflayer.createBot(config.connection)

registerBotEvents(bot)

const registry = createCommandRegistry()
registerGeneralCommands(registry, bot)

startConsole(registry, { bot })

log.info(`Pripojuju se na ${config.connection.host}:${config.connection.port}...`)
