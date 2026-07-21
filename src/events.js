const log = require('./lib/logger')
const config = require('./config')
const { runLobbyTransfer } = require('./features/lobbyTransfer')
const { startViewerIfEnabled, stopViewer } = require('./features/viewer')

let suppressedParticleReadErrors = 0

function isParticleReadError(err) {
  const text = `${err?.name || ''}\n${err?.message || ''}\n${err?.stack || ''}`
  return text.includes('PartialReadError') && text.includes('packet_world_particles')
}

function registerBotEvents(bot) {
  let lobbyTransferPromise = null

  bot.once('login', () => {
    log.info(`Prihlasen jako ${bot.username}`)
  })

  bot.on('spawn', () => {
    const pos = bot.entity?.position
    log.info(`Spawn ve svete: ${pos ? `${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}` : 'pozice neznama'}`)

    startViewerIfEnabled(bot).catch(err => {
      log.error(`Auto viewer spadl: ${err.stack || err.message}`)
    })

    if (config.lobbyTransfer.enabled) {
      if (!lobbyTransferPromise) {
        lobbyTransferPromise = runLobbyTransfer(bot)
          .catch(err => {
            log.error(`Auto lobby transfer spadl: ${err.stack || err.message}`)
          })
          .finally(() => {
            lobbyTransferPromise = null
          })
      }
    }
  })

  bot.on('messagestr', (message) => {
    log.info(`[MC] ${message}`)
  })

  bot.on('kicked', (reason) => {
    log.warn(`Kick: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
  })

  bot.on('end', (reason) => {
    stopViewer(bot, { silent: true })
    log.warn(`Odpojeno: ${reason || 'bez duvodu'}`)
  })

  bot.on('error', (err) => {
    if (isParticleReadError(err)) {
      suppressedParticleReadErrors++
      if (suppressedParticleReadErrors === 1) {
        log.warn('Ignoruju opakovanou PartialReadError chybu u particles. Pokud by se bot choval divne, zkus jinou MC_VERSION, napr. MC_VERSION=1.21.1 nebo MC_VERSION=1.20.4.')
      }
      return
    }

    log.error(`Mineflayer error: ${err.stack || err.message}`)
  })
}

module.exports = {
  registerBotEvents
}
