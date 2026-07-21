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
const { createBotController } = require('./src/botController')

const controller = createBotController({
  createBot: () => mineflayer.createBot(config.connection),
  prepareBot: bot => {
    bot.loadPlugin(injectInteractionSequence)
    registerBotEvents(bot)
  },
  reconnect: config.reconnect,
  connectionLabel: `${config.connection.host}:${config.connection.port}`,
  log
})

const registry = createCommandRegistry()
registerGeneralCommands(registry, controller)
registerMiningCommands(registry, controller)
registerViewerCommands(registry, controller)

startConsole(registry, { controller })
controller.start()
