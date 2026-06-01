const net = require('net')

const config = require('../config')
const log = require('../lib/logger')

const DEFAULT_PORT = 3000
const DEFAULT_VIEW_DISTANCE = 6

let mineflayerViewer = null
const states = new WeakMap()

function getState(bot) {
  if (!states.has(bot)) {
    states.set(bot, {
      started: false,
      starting: false,
      url: null,
      options: null
    })
  }

  return states.get(bot)
}

function normalizePort(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 1 || value > 65535) return DEFAULT_PORT
  return value
}

function normalizeViewDistance(viewDistance) {
  const value = Number(viewDistance)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_VIEW_DISTANCE
  return value
}

function resolveOptions(overrides = {}) {
  return {
    port: normalizePort(overrides.port ?? config.viewer.port),
    viewDistance: normalizeViewDistance(overrides.viewDistance ?? config.viewer.viewDistance),
    firstPerson: overrides.firstPerson ?? config.viewer.firstPerson,
    publicHost: overrides.publicHost || config.viewer.publicHost
  }
}

function formatViewerUrl(options) {
  const host = options.publicHost || 'localhost'
  return `http://${host}:${options.port}`
}

function loadViewer() {
  if (mineflayerViewer) return { ok: true, viewer: mineflayerViewer }

  try {
    mineflayerViewer = require('prismarine-viewer').mineflayer
    return { ok: true, viewer: mineflayerViewer }
  } catch (err) {
    const missingCanvas = err?.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes("'canvas'")
    const hint = missingCanvas ? ' Chybi balicek canvas, zkus: npm install canvas' : ''
    return {
      ok: false,
      message: `Nepodarilo se nacist prismarine-viewer: ${err.message}.${hint}`,
      error: err
    }
  }
}

function checkPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()

    server.once('error', err => {
      resolve({ ok: false, error: err })
    })

    server.once('listening', () => {
      server.close(() => resolve({ ok: true }))
    })

    server.listen(port)
  })
}

async function startViewer(bot, overrides = {}) {
  const state = getState(bot)

  if (state.started) {
    return { ok: true, already: true, url: state.url, options: state.options }
  }

  if (state.starting) {
    return { ok: false, message: 'Viewer se prave startuje.' }
  }

  if (!bot.entity?.position) {
    return { ok: false, message: 'Bot jeste neni spawnuty ve svete.' }
  }

  state.starting = true

  try {
    const loaded = loadViewer()
    if (!loaded.ok) return loaded

    const options = resolveOptions(overrides)
    const portCheck = await checkPortAvailable(options.port)
    if (!portCheck.ok) {
      const reason = portCheck.error?.code || portCheck.error?.message || 'neznamy duvod'
      return { ok: false, message: `Port ${options.port} pro viewer neni volny (${reason}).` }
    }

    loaded.viewer(bot, {
      port: options.port,
      viewDistance: options.viewDistance,
      firstPerson: options.firstPerson
    })

    state.started = true
    state.options = options
    state.url = formatViewerUrl(options)

    log.info(`Prismarine viewer bezi na ${state.url}`)
    return { ok: true, already: false, url: state.url, options }
  } catch (err) {
    return { ok: false, message: `Viewer se nepodarilo spustit: ${err.message}`, error: err }
  } finally {
    state.starting = false
  }
}

function stopViewer(bot, options = {}) {
  const state = getState(bot)
  const close = bot.viewer?.close

  if (!state.started && typeof close !== 'function') {
    return { ok: false, message: 'Viewer nebezi.' }
  }

  try {
    if (typeof close === 'function') close.call(bot.viewer)
    delete bot.viewer
  } catch (err) {
    state.started = false
    state.options = null
    state.url = null
    return { ok: false, message: `Viewer se nepodarilo zastavit: ${err.message}`, error: err }
  }

  state.started = false
  state.options = null
  state.url = null

  if (!options.silent) log.info('Prismarine viewer zastaven.')
  return { ok: true }
}

function getViewerStatus(bot) {
  const state = getState(bot)
  const running = state.started && typeof bot.viewer?.close === 'function'

  return {
    running,
    starting: state.starting,
    url: running ? state.url : null,
    options: running ? state.options : resolveOptions()
  }
}

async function startViewerIfEnabled(bot) {
  if (!config.viewer.enabled) return { ok: false, skipped: true, message: 'Viewer neni povoleny v konfiguraci.' }

  const result = await startViewer(bot)
  if (!result.ok) log.warn(result.message)
  return result
}

module.exports = {
  startViewer,
  stopViewer,
  getViewerStatus,
  startViewerIfEnabled,
  formatViewerUrl
}
