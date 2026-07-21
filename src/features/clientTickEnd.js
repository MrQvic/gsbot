const CLIENT_TICK_MS = 50
const states = new WeakMap()

const MOVEMENT_PACKETS = new Set([
  'flying',
  'position',
  'look',
  'position_look'
])

const CLIENT_TICK_PACKETS = new Set([
  ...MOVEMENT_PACKETS,
  'block_dig',
  'block_place',
  'use_item',
  'use_entity',
  'arm_animation',
  'entity_action',
  'held_item_slot',
  'player_input'
])

function resetOpenTick(state) {
  state.tickOpen = false
  state.movementSent = false
}

function closeOpenTick(state) {
  if (!state.tickOpen) return false

  resetOpenTick(state)
  if (state.sendsTickEnd) state.originalWrite.call(state.client, 'tick_end', {})
  return true
}

function reportAsyncError(bot, err) {
  if (bot.listenerCount('error') > 0) bot.emit('error', err)
}

function scheduleTickClose(bot, state) {
  const tickId = state.tickId
  queueMicrotask(() => {
    if (states.get(bot) !== state || !state.tickOpen || state.tickId !== tickId) return

    try {
      closeOpenTick(state)
    } catch (err) {
      reportAsyncError(bot, err)
    }
  })
}

function openTick(bot, state) {
  state.tickOpen = true
  state.movementSent = false
  state.tickId++
  scheduleTickClose(bot, state)
}

function startClientTickEnd(bot, onTick = null) {
  const sendsTickEnd = !bot.registry.version['<']('1.21.2')
  if (!sendsTickEnd && !onTick) return false
  if (states.has(bot)) return true

  const client = bot._client
  const originalWrite = client.write
  const state = {
    client,
    originalWrite,
    wrappedWrite: null,
    sendsTickEnd,
    onTick,
    tickOpen: false,
    movementSent: false,
    tickId: 0,
    onPhysicsTick: null,
    onEnd: null
  }

  state.wrappedWrite = function (name, params) {
    if (name === 'tick_end') {
      const result = originalWrite.call(this, name, params)
      resetOpenTick(state)
      return result
    }

    if (CLIENT_TICK_PACKETS.has(name)) {
      if (!state.tickOpen) openTick(bot, state)

      // Mineflayer can execute multiple catch-up physics ticks in one timer callback.
      // Never allow two movement packets to share one client-tick boundary.
      if (MOVEMENT_PACKETS.has(name) && state.movementSent) {
        closeOpenTick(state)
        openTick(bot, state)
      }

      const result = originalWrite.call(this, name, params)
      if (MOVEMENT_PACKETS.has(name)) state.movementSent = true
      return result
    }

    return originalWrite.call(this, name, params)
  }

  state.onPhysicsTick = () => {
    // physicsTick is emitted immediately before Mineflayer writes the movement packet.
    // Closing the previous tick here separates synchronous catch-up iterations; the
    // microtask scheduled by openTick closes the final iteration after updatePosition.
    closeOpenTick(state)
    openTick(bot, state)
    onTick?.()
  }
  state.onEnd = () => stopClientTickEnd(bot, { flush: false })

  states.set(bot, state)
  client.write = state.wrappedWrite
  bot.on('physicsTick', state.onPhysicsTick)
  bot.once('end', state.onEnd)
  return true
}

function stopClientTickEnd(bot, options = {}) {
  const state = states.get(bot)
  if (!state) return false

  bot.removeListener('physicsTick', state.onPhysicsTick)
  bot.removeListener('end', state.onEnd)

  if (options.flush) closeOpenTick(state)
  else resetOpenTick(state)

  if (state.client.write === state.wrappedWrite) state.client.write = state.originalWrite
  states.delete(bot)
  return true
}

module.exports = {
  CLIENT_TICK_MS,
  startClientTickEnd,
  stopClientTickEnd
}
