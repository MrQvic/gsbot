const { performance } = require('perf_hooks')

const config = require('../config')
const log = require('../lib/logger')
const { sleep } = require('../lib/wait')
const { createMiningTrace } = require('./miningTrace')

const MAX_REACH = 5.1
const TRACE_BLOCK_DISTANCE = 7
const states = new WeakMap()

function getState(bot) {
  if (!states.has(bot)) {
    states.set(bot, {
      running: false,
      loopPromise: null,
      currentTarget: null,
      lockedDirection: null,
      lockedYaw: null,
      lockedPitch: null,
      originalLookAt: null,
      suppressedLookAt: null,
      startedAt: null,
      finishedAt: null,
      completed: 0,
      aborted: 0,
      retargets: 0,
      errors: 0,
      lastBlockName: null,
      lastError: null,
      digAttempt: 0,
      waitingForTarget: false,
      trace: null,
      traceFile: null,
      stopReason: null,
      updateVersion: 0,
      wake: null,
      onBlockUpdate: null,
      onDeath: null,
      onKicked: null,
      onEnd: null
    })
  }

  return states.get(bot)
}

function samePosition(a, b) {
  return Boolean(a?.position && b?.position && a.position.equals(b.position))
}

function number(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null
}

function vectorSnapshot(vector) {
  if (!vector) return null
  return {
    x: number(vector.x),
    y: number(vector.y),
    z: number(vector.z)
  }
}

function getEyePosition(bot) {
  const entity = bot.entity
  const eyeHeight = entity?.eyeHeight ?? entity?.height
  if (!entity?.position || !Number.isFinite(eyeHeight)) return null
  return entity.position.offset(0, eyeHeight, 0)
}

function blockSnapshot(bot, block) {
  if (!block) return null

  const eyePosition = getEyePosition(bot)
  const center = block.position?.offset(0.5, 0.5, 0.5)
  return {
    name: block.name,
    type: block.type,
    stateId: block.stateId,
    position: vectorSnapshot(block.position),
    face: block.face,
    intersect: vectorSnapshot(block.intersect),
    eyeToIntersect: eyePosition && block.intersect ? number(eyePosition.distanceTo(block.intersect)) : null,
    eyeToCenter: eyePosition && center ? number(eyePosition.distanceTo(center)) : null
  }
}

function itemSnapshot(item, registry) {
  if (!item) return null

  let enchantments = []
  const serialized = item.componentMap?.get('enchantments')?.data?.enchantments
  if (Array.isArray(serialized)) {
    enchantments = serialized.map(enchantment => ({
      name: registry.enchantments[enchantment.id]?.name || null,
      level: enchantment.level
    }))
  } else {
    try {
      if (Array.isArray(item.enchants)) enchantments = item.enchants
    } catch (_) {}
  }

  return {
    name: item.name,
    type: item.type,
    count: item.count,
    durabilityUsed: item.durabilityUsed,
    enchantments
  }
}

function traceRecord(state, event, data = {}) {
  state.trace?.record(event, data)
}

function getViewDirection(entity) {
  if (!Number.isFinite(entity?.yaw) || !Number.isFinite(entity?.pitch) || !entity?.position) return null

  const cosPitch = Math.cos(entity.pitch)
  return entity.position.clone().set(
    -Math.sin(entity.yaw) * cosPitch,
    Math.sin(entity.pitch),
    -Math.cos(entity.yaw) * cosPitch
  ).normalize()
}

function getCursorBlock(bot, lockedDirection = null) {
  const entity = bot.entity
  const eyeHeight = entity?.eyeHeight ?? entity?.height
  const direction = lockedDirection || getViewDirection(entity)

  if (!entity?.position || !bot.world?.raycast || !direction || !Number.isFinite(eyeHeight)) return null

  const eyePosition = entity.position.offset(0, eyeHeight, 0)
  return bot.world.raycast(eyePosition, direction.clone(), MAX_REACH)
}

function getDiggableCursorBlock(bot, lockedDirection = null) {
  const block = getCursorBlock(bot, lockedDirection)
  if (!block || block.type === 0 || !bot.canDigBlock(block)) return null
  return block
}

function signalUpdate(state) {
  state.updateVersion++
  if (!state.wake) return

  const wake = state.wake
  state.wake = null
  wake()
}

function waitForUpdate(state, observedVersion) {
  if (!state.running || state.updateVersion !== observedVersion) return Promise.resolve()

  return new Promise(resolve => {
    let finished = false
    const timeout = setTimeout(finish, 50)

    function finish() {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      if (state.wake === finish) state.wake = null
      resolve()
    }

    state.wake = finish
  })
}

function abortForCloserBlock(bot, state, oldBlock, newBlock) {
  signalUpdate(state)

  const changedBlock = newBlock || oldBlock
  const eyePosition = getEyePosition(bot)
  const changedCenter = changedBlock?.position?.offset(0.5, 0.5, 0.5)
  if (eyePosition && changedCenter && eyePosition.distanceTo(changedCenter) <= TRACE_BLOCK_DISTANCE) {
    traceRecord(state, 'world_block_update', {
      source: 'mineflayer_world',
      oldBlock: blockSnapshot(bot, oldBlock),
      newBlock: blockSnapshot(bot, newBlock)
    })
  }

  const active = bot.targetDigBlock
  if (!state.running || !state.currentTarget || !active) return

  // Let Mineflayer finish its own dig when the active block becomes air.
  if (newBlock?.type === 0 && samePosition(active, newBlock)) return

  const cursorBlock = getCursorBlock(bot, state.lockedDirection)
  if (samePosition(active, cursorBlock)) return

  state.retargets++
  traceRecord(state, 'retarget', {
    active: blockSnapshot(bot, active),
    nextTarget: blockSnapshot(bot, cursorBlock),
    update: {
      oldBlock: blockSnapshot(bot, oldBlock),
      newBlock: blockSnapshot(bot, newBlock)
    }
  })
  bot.stopDigging()
}

function attachListeners(bot, state) {
  state.onBlockUpdate = (oldBlock, newBlock) => {
    abortForCloserBlock(bot, state, oldBlock, newBlock)
  }
  state.onDeath = () => {
    traceRecord(state, 'death')
    stopContinuousMining(bot, { reason: 'death' }).catch(err => {
      log.error(`Zastaveni tezby po smrti selhalo: ${err.stack || err.message}`)
    })
  }
  state.onKicked = reason => {
    traceRecord(state, 'kicked', { reason })
  }
  state.onEnd = reason => {
    traceRecord(state, 'connection_end', { reason })
    stopContinuousMining(bot, { reason: `connection_end:${reason || 'unknown'}` }).catch(err => {
      log.error(`Zastaveni tezby po odpojeni selhalo: ${err.stack || err.message}`)
    })
  }

  bot.on('blockUpdate', state.onBlockUpdate)
  bot.once('death', state.onDeath)
  bot.once('kicked', state.onKicked)
  bot.once('end', state.onEnd)
}

function detachListeners(bot, state) {
  if (state.onBlockUpdate) bot.removeListener('blockUpdate', state.onBlockUpdate)
  if (state.onDeath) bot.removeListener('death', state.onDeath)
  if (state.onKicked) bot.removeListener('kicked', state.onKicked)
  if (state.onEnd) bot.removeListener('end', state.onEnd)

  state.onBlockUpdate = null
  state.onDeath = null
  state.onKicked = null
  state.onEnd = null
}

function isExpectedDigInterruption(err) {
  return ['Digging aborted', 'Block not in view'].includes(err?.message)
}

function suppressLookAt(bot, state) {
  state.originalLookAt = bot.lookAt
  state.suppressedLookAt = async () => {}
  bot.lookAt = state.suppressedLookAt
}

function restoreLookAt(bot, state) {
  if (state.originalLookAt && bot.lookAt === state.suppressedLookAt) {
    bot.lookAt = state.originalLookAt
  }

  state.originalLookAt = null
  state.suppressedLookAt = null
}

function temporarilyNormalizeItemEnchantments(item, registry) {
  const component = item?.componentMap?.get('enchantments')
  const serializedEnchantments = component?.data?.enchantments
  if (!Array.isArray(serializedEnchantments)) return null

  const originalData = component.data
  component.data = serializedEnchantments.map(enchantment => ({
    name: registry.enchantments[enchantment.id]?.name || null,
    lvl: enchantment.level
  }))

  return () => {
    component.data = originalData
  }
}

function getDigFaceVector(block) {
  const faces = {
    0: [0, -1, 0],
    1: [0, 1, 0],
    2: [0, 0, -1],
    3: [0, 0, 1],
    4: [-1, 0, 0],
    5: [1, 0, 0]
  }
  const coordinates = faces[block.face]
  if (!coordinates) return 'raycast'
  return block.position.clone().set(...coordinates)
}

function digWithNormalizedEnchantments(bot, state, block, attempt) {
  const headSlot = bot.getEquipmentDestSlot?.('head')
  const helmet = headSlot === undefined ? null : bot.inventory?.slots?.[headSlot]
  const items = new Set([bot.heldItem, helmet].filter(Boolean))
  const restore = [...items]
    .map(item => temporarilyNormalizeItemEnchantments(item, bot.registry))
    .filter(Boolean)

  try {
    const digFace = getDigFaceVector(block)
    traceRecord(state, 'dig_start', {
      attempt,
      target: blockSnapshot(bot, block),
      digFace: typeof digFace === 'string' ? digFace : vectorSnapshot(digFace),
      plannedDigTimeMs: number(bot.digTime(block)),
      heldItem: itemSnapshot(bot.heldItem, bot.registry),
      player: {
        position: vectorSnapshot(bot.entity?.position),
        yaw: number(bot.entity?.yaw),
        pitch: number(bot.entity?.pitch),
        onGround: bot.entity?.onGround
      }
    })

    // Mineflayer reads enchantments synchronously before bot.dig() returns its promise.
    return bot.dig(block, true, digFace)
  } finally {
    for (const restoreItem of restore.reverse()) restoreItem()
  }
}

async function runMiningLoop(bot, state) {
  while (state.running) {
    const observedVersion = state.updateVersion
    const block = getDiggableCursorBlock(bot, state.lockedDirection)

    if (!block) {
      state.currentTarget = null
      if (!state.waitingForTarget) {
        state.waitingForTarget = true
        traceRecord(state, 'target_empty', {
          player: {
            position: vectorSnapshot(bot.entity?.position),
            yaw: number(bot.entity?.yaw),
            pitch: number(bot.entity?.pitch)
          }
        })
      }
      await waitForUpdate(state, observedVersion)
      continue
    }

    state.waitingForTarget = false
    state.currentTarget = block
    state.lastBlockName = block.name
    const attempt = ++state.digAttempt
    const attemptStartedAt = performance.now()

    traceRecord(state, 'target_selected', {
      attempt,
      target: blockSnapshot(bot, block)
    })

    try {
      await digWithNormalizedEnchantments(bot, state, block, attempt)
      const durationMs = number(performance.now() - attemptStartedAt)
      traceRecord(state, 'dig_complete', {
        attempt,
        target: blockSnapshot(bot, block),
        durationMs
      })

      if (state.running) {
        state.completed++
        if (config.mining.nextBlockDelayMs > 0) {
          traceRecord(state, 'post_break_delay', {
            attempt,
            delayMs: config.mining.nextBlockDelayMs
          })
          await sleep(config.mining.nextBlockDelayMs)
        }
      }
    } catch (err) {
      const durationMs = number(performance.now() - attemptStartedAt)
      if (!state.running) {
        traceRecord(state, 'dig_abort', {
          attempt,
          reason: 'mining_stopped',
          error: err,
          durationMs
        })
        break
      }

      if (isExpectedDigInterruption(err)) {
        state.aborted++
        traceRecord(state, 'dig_abort', {
          attempt,
          reason: err.message,
          durationMs
        })
        if (err.message === 'Block not in view') await sleep(10)
      } else {
        state.errors++
        state.lastError = err.message
        traceRecord(state, 'dig_error', {
          attempt,
          error: err,
          durationMs
        })
        log.warn(`Prubezna tezba: ${err.message}`)
        await sleep(50)
      }
    } finally {
      state.currentTarget = null
    }
  }
}

function startContinuousMining(bot) {
  const state = getState(bot)

  if (state.running) return { ok: true, already: true, status: getContinuousMiningStatus(bot) }
  if (state.loopPromise) return { ok: false, message: 'Tezba se prave zastavuje.' }
  if (!bot.entity?.position) return { ok: false, message: 'Bot jeste neni spawnuty ve svete.' }
  if (!bot.heldItem?.name?.endsWith('_pickaxe')) {
    return { ok: false, message: 'Bot musi mit v ruce krumpac.' }
  }

  const lockedDirection = getViewDirection(bot.entity)
  if (!lockedDirection) return { ok: false, message: 'Bot nema platny smer pohledu.' }

  state.running = true
  state.currentTarget = null
  state.lockedDirection = lockedDirection
  state.lockedYaw = bot.entity.yaw
  state.lockedPitch = bot.entity.pitch
  state.startedAt = Date.now()
  state.finishedAt = null
  state.completed = 0
  state.aborted = 0
  state.retargets = 0
  state.errors = 0
  state.lastBlockName = null
  state.lastError = null
  state.digAttempt = 0
  state.waitingForTarget = false
  state.trace = null
  state.traceFile = null
  state.stopReason = null
  state.updateVersion = 0
  state.wake = null

  try {
    state.trace = createMiningTrace(bot, {
      enabled: config.mining.traceEnabled,
      folder: config.mining.traceFolder
    })
  } catch (err) {
    log.warn(`Mining trace se nepodarilo spustit: ${err.message}`)
  }

  if (state.trace) {
    state.traceFile = state.trace.filePath
    traceRecord(state, 'session_start', {
      username: bot.username,
      minecraftVersion: bot.version,
      protocolVersion: bot.protocolVersion,
      gameMode: bot.game?.gameMode,
      dimension: bot.game?.dimension,
      player: {
        position: vectorSnapshot(bot.entity.position),
        yaw: number(bot.entity.yaw),
        pitch: number(bot.entity.pitch),
        onGround: bot.entity.onGround
      },
      lockedDirection: vectorSnapshot(state.lockedDirection),
      cursor: blockSnapshot(bot, getCursorBlock(bot, state.lockedDirection)),
      heldItem: itemSnapshot(bot.heldItem, bot.registry),
      effects: bot.entity.effects,
      settings: {
        maxReach: MAX_REACH,
        nextBlockDelayMs: config.mining.nextBlockDelayMs,
        lookAtSuppressed: true
      }
    })
    log.info(`Mining trace: ${state.traceFile}`)
  }

  suppressLookAt(bot, state)
  attachListeners(bot, state)

  const loopPromise = runMiningLoop(bot, state)
    .catch(err => {
      state.errors++
      state.lastError = err.message
      state.stopReason = 'loop_error'
      state.running = false
      traceRecord(state, 'loop_error', { error: err })
      log.error(`Prubezna tezba spadla: ${err.stack || err.message}`)
    })
    .finally(() => {
      state.running = false
      state.currentTarget = null
      state.lockedDirection = null
      state.lockedYaw = null
      state.lockedPitch = null
      state.finishedAt = Date.now()
      signalUpdate(state)
      detachListeners(bot, state)
      restoreLookAt(bot, state)
      state.trace?.close({
        reason: state.stopReason || 'loop_finished',
        completed: state.completed,
        aborted: state.aborted,
        retargets: state.retargets,
        errors: state.errors,
        lastBlockName: state.lastBlockName,
        lastError: state.lastError
      })
      state.trace = null
      if (state.loopPromise === loopPromise) state.loopPromise = null
    })

  state.loopPromise = loopPromise
  log.info(`Prubezna tezba spustena s ${bot.heldItem.name}.`)

  return { ok: true, already: false, status: getContinuousMiningStatus(bot) }
}

async function stopContinuousMining(bot, options = {}) {
  const state = getState(bot)
  if (!state.running && !state.loopPromise) {
    return { ok: false, message: 'Tezba nebezi.', status: getContinuousMiningStatus(bot) }
  }

  state.stopReason = options.reason || 'command'
  traceRecord(state, 'stop_requested', { reason: state.stopReason })
  state.running = false
  signalUpdate(state)

  if (state.currentTarget && samePosition(state.currentTarget, bot.targetDigBlock)) {
    bot.stopDigging()
  }

  if (state.loopPromise) await state.loopPromise
  log.info('Prubezna tezba zastavena.')

  return { ok: true, status: getContinuousMiningStatus(bot) }
}

function getContinuousMiningStatus(bot) {
  const state = getState(bot)
  const cursorBlock = getCursorBlock(bot)
  const lockedCursorBlock = state.lockedDirection ? getCursorBlock(bot, state.lockedDirection) : null

  return {
    running: state.running,
    heldItem: bot.heldItem?.name || null,
    nextBlockDelayMs: config.mining.nextBlockDelayMs,
    traceEnabled: config.mining.traceEnabled,
    traceActive: Boolean(state.trace?.active),
    traceFile: state.traceFile,
    directionLocked: Boolean(state.lockedDirection),
    lookAtSuppressed: Boolean(state.originalLookAt && bot.lookAt === state.suppressedLookAt),
    lockedYaw: state.lockedYaw,
    lockedPitch: state.lockedPitch,
    cursor: cursorBlock
      ? {
          name: cursorBlock.name,
          position: cursorBlock.position.clone(),
          diggable: bot.canDigBlock(cursorBlock)
        }
      : null,
    lockedCursor: lockedCursorBlock
      ? {
          name: lockedCursorBlock.name,
          position: lockedCursorBlock.position.clone(),
          diggable: bot.canDigBlock(lockedCursorBlock)
        }
      : null,
    target: state.currentTarget
      ? {
          name: state.currentTarget.name,
          position: state.currentTarget.position.clone()
        }
      : null,
    startedAt: state.startedAt,
    elapsedMs: state.startedAt
      ? (state.running ? Date.now() : state.finishedAt || Date.now()) - state.startedAt
      : 0,
    completed: state.completed,
    aborted: state.aborted,
    retargets: state.retargets,
    errors: state.errors,
    lastBlockName: state.lastBlockName,
    lastError: state.lastError
  }
}

module.exports = {
  startContinuousMining,
  stopContinuousMining,
  getContinuousMiningStatus
}
