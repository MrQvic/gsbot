const mineflayer = require('mineflayer')

const config = require('./src/config')
const log = require('./src/lib/logger')
const { createCommandRegistry } = require('./src/commands/registry')
const { registerGeneralCommands } = require('./src/commands/general')
const { registerMiningCommands } = require('./src/commands/mining')
const { registerViewerCommands } = require('./src/commands/viewer')
const { registerBotEvents } = require('./src/events')
const { injectInteractionSequence } = require('./src/features/interactionSequence')
const { startConsole } = require('./src/console')

const bot = mineflayer.createBot(config.connection)
bot.loadPlugin(injectInteractionSequence)

registerBotEvents(bot)

const registry = createCommandRegistry()
registerGeneralCommands(registry, bot)
registerMiningCommands(registry, bot)
registerViewerCommands(registry, bot)

startConsole(registry, { bot })

log.info(`Pripojuju se na ${config.connection.host}:${config.connection.port}...`)
