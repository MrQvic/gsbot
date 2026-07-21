function stringifyReason(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Error) return value.stack || value.message || String(value)
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function formatDelay(milliseconds) {
  if (milliseconds < 60000) return `${Math.ceil(milliseconds / 1000)} s`
  return `${Math.ceil(milliseconds / 60000)} min`
}

function createBotController(options = {}) {
  if (typeof options.createBot !== 'function') throw new Error('createBot is required')

  const createBot = options.createBot
  const prepareBot = options.prepareBot || (() => {})
  const log = options.log || console
  const reconnectEnabled = options.reconnect?.enabled !== false
  const reconnectDelaysMs = Array.isArray(options.reconnect?.delaysMs) && options.reconnect.delaysMs.length > 0
    ? options.reconnect.delaysMs.map(value => Math.max(0, Number(value) || 0))
    : [60000, 300000, 900000, 1800000, 3600000]
  const connectionLabel = options.connectionLabel || 'Minecraft server'

  let bot = null
  let state = 'OFFLINE'
  let desiredOnline = false
  let stopping = false
  let sessionId = 0
  let reconnectPlanId = 0
  let reconnectTimer = null
  let reconnectAt = null
  let retryIndex = 0
  let lastDisconnect = null
  let lastConnectedAt = null

  function cancelReconnect() {
    reconnectPlanId++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    reconnectAt = null
  }

  function scheduleReconnect() {
    if (!desiredOnline || stopping || !reconnectEnabled || bot) {
      state = 'OFFLINE'
      return false
    }

    cancelReconnect()

    const delayIndex = Math.min(retryIndex, reconnectDelaysMs.length - 1)
    const delayMs = reconnectDelaysMs[delayIndex]
    retryIndex++
    const planId = reconnectPlanId

    reconnectAt = Date.now() + delayMs
    state = 'WAITING_RECONNECT'
    log.warn(`Dalsi pokus o pripojeni za ${formatDelay(delayMs)}.`)

    reconnectTimer = setTimeout(() => {
      if (planId !== reconnectPlanId) return

      reconnectTimer = null
      reconnectAt = null

      if (!desiredOnline || stopping || bot) return
      connect('auto-reconnect')
    }, delayMs)

    return true
  }

  function recordDisconnect(currentBot, currentSessionId, endReason, session) {
    if (bot !== currentBot || sessionId !== currentSessionId) return

    bot = null
    lastDisconnect = {
      at: Date.now(),
      endReason: stringifyReason(endReason),
      kickReason: stringifyReason(session.kickReason),
      error: stringifyReason(session.error)
    }

    if (!desiredOnline || stopping) {
      state = 'OFFLINE'
      return
    }

    if (!reconnectEnabled) {
      state = 'OFFLINE'
      log.warn('Automaticky reconnect je vypnuty.')
      return
    }

    scheduleReconnect()
  }

  function attachLifecycle(currentBot, currentSessionId) {
    const session = {
      spawned: false,
      kickReason: null,
      error: null
    }

    currentBot.on('spawn', () => {
      if (bot !== currentBot || sessionId !== currentSessionId || stopping) return

      if (!session.spawned) {
        session.spawned = true
        retryIndex = 0
        lastConnectedAt = Date.now()
      }

      state = 'ONLINE'
    })

    currentBot.on('kicked', reason => {
      session.kickReason = reason
    })

    currentBot.on('error', err => {
      session.error = err
    })

    currentBot.once('end', reason => {
      recordDisconnect(currentBot, currentSessionId, reason, session)
    })
  }

  function handleConnectFailure(err) {
    bot = null
    state = 'OFFLINE'
    lastDisconnect = {
      at: Date.now(),
      endReason: 'createBot failed',
      kickReason: null,
      error: stringifyReason(err)
    }
    log.error(`Pripojeni se nepodarilo vytvorit: ${err.stack || err.message}`)

    if (desiredOnline && !stopping && reconnectEnabled) scheduleReconnect()
  }

  function connect(source = 'manual') {
    if (stopping) return { ok: false, message: 'Bot se ukoncuje.' }
    if (bot) return { ok: true, already: true, bot, state }

    desiredOnline = true
    cancelReconnect()
    state = 'CONNECTING'
    sessionId++
    const currentSessionId = sessionId

    log.info(`Pripojuju se na ${connectionLabel} (${source})...`)

    let currentBot
    try {
      currentBot = createBot()
      bot = currentBot
      attachLifecycle(currentBot, currentSessionId)
      prepareBot(currentBot)
    } catch (err) {
      if (currentBot && bot === currentBot) {
        bot = null
        try {
          currentBot.quit?.('setup failed')
        } catch (_) {}
      }
      handleConnectFailure(err)
      return { ok: false, message: err.message, error: err }
    }

    return { ok: true, already: false, bot: currentBot, state }
  }

  function start() {
    return connect('startup')
  }

  function disconnect(reason = 'manual disconnect') {
    desiredOnline = false
    cancelReconnect()

    const currentBot = bot
    if (!currentBot) {
      state = 'OFFLINE'
      return { ok: true, already: true }
    }

    state = 'STOPPING'
    try {
      currentBot.quit?.(reason)
    } finally {
      if (bot === currentBot) bot = null
      state = 'OFFLINE'
    }

    return { ok: true, already: false }
  }

  function shutdown(reason = 'shutdown') {
    stopping = true
    return disconnect(reason)
  }

  function getStatus() {
    return {
      state,
      desiredOnline,
      reconnectEnabled,
      reconnectAt,
      retryIndex,
      sessionId,
      lastConnectedAt,
      lastDisconnect
    }
  }

  return {
    start,
    connect,
    disconnect,
    shutdown,
    getBot: () => bot,
    getStatus
  }
}

module.exports = {
  createBotController,
  stringifyReason
}
