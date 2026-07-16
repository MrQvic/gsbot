const { performance } = require('perf_hooks')

const config = require('../config')
const log = require('../lib/logger')
const { sleep } = require('../lib/wait')
const { CLIENT_TICK_MS, startClientTickEnd, stopClientTickEnd } = require('./clientTickEnd')
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
      activeDig: null,
      retainedDig: null,
      originalStopDigging: null,
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

  const retained = state.retainedDig
  if (
    retained &&
    oldBlock?.type === retained.type &&
    oldBlock.position.equals(retained.position) &&
    (!newBlock || newBlock.type === 0 || newBlock.type !== retained.type)
  ) {
    traceRecord(state, 'dig_progress_discarded', {
      reason: 'retained_block_changed',
      target: blockSnapshot(bot, oldBlock),
      remainingDigTicks: retained.ticksRemaining
    })
    state.retainedDig = null
  }

  const activeControl = state.activeDig
  const active = activeControl?.block
  if (!state.running || !state.currentTarget || !active) return

  // Let the active dig resolve when its block becomes air.
  if (newBlock?.type === 0 && samePosition(active, newBlock)) return

  const cursorBlock = getCursorBlock(bot, state.lockedDirection)
  if (samePosition(active, cursorBlock)) return

  // Vanilla keeps the current target and progress when the blocking target breaks on its initial hit.
  let progressRetained = false
  if (cursorBlock && cursorBlock.type !== 0 && bot.canDigBlock(cursorBlock)) {
    try {
      progressRetained = getPlannedDigTime(bot, cursorBlock) === 0
    } catch (_) {}
  }

  activeControl.abortFace = cursorBlock?.face ?? activeControl.face
  if (progressRetained) {
    state.retainedDig = {
      position: active.position.clone(),
      type: active.type,
      stateId: active.stateId,
      face: activeControl.face,
      plannedDigTimeMs: activeControl.plannedDigTimeMs,
      ticksRemaining: activeControl.ticksRemaining,
      heldItemType: bot.heldItem?.type || null,
      skipAbortOnce: true
    }
    traceRecord(state, 'dig_progress_retained', {
      target: blockSnapshot(bot, active),
      blocker: blockSnapshot(bot, cursorBlock),
      plannedDigTimeMs: activeControl.plannedDigTimeMs,
      remainingDigTicks: activeControl.ticksRemaining,
      remainingDigTimeMs: activeControl.ticksRemaining * CLIENT_TICK_MS
    })
  } else {
    state.retainedDig = null
  }

  state.retargets++
  traceRecord(state, 'retarget', {
    active: blockSnapshot(bot, active),
    nextTarget: blockSnapshot(bot, cursorBlock),
    progressRetained,
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

function temporarilyNormalizeBlockMaterial(block, heldItem, registry) {
  const heldItemType = heldItem?.type
  const materialToolMultipliers = registry.materials[block?.material]
  if (!heldItemType || materialToolMultipliers?.[heldItemType]) return null
  if (!block.harvestTools?.[heldItemType]) return null

  const toolType = heldItem.name?.split('_').pop()
  const fallbackMaterial = `mineable/${toolType}`
  if (!registry.materials[fallbackMaterial]?.[heldItemType]) return null

  const originalMaterial = block.material
  block.material = fallbackMaterial

  return () => {
    block.material = originalMaterial
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

function temporarilyNormalizeDigData(bot, block) {
  const headSlot = bot.getEquipmentDestSlot?.('head')
  const helmet = headSlot === undefined ? null : bot.inventory?.slots?.[headSlot]
  const items = new Set([bot.heldItem, helmet].filter(Boolean))
  const restore = [
    temporarilyNormalizeBlockMaterial(block, bot.heldItem, bot.registry),
    ...[...items].map(item => temporarilyNormalizeItemEnchantments(item, bot.registry))
  ].filter(Boolean)

  return () => {
    for (const restoreItem of restore.reverse()) restoreItem()
  }
}

function getPlannedDigTime(bot, block) {
  const restore = temporarilyNormalizeDigData(bot, block)
  try {
    return bot.digTime(block)
  } finally {
    restore()
  }
}

function sameRetainedTarget(retained, block, heldItem) {
  return Boolean(
    retained &&
    block?.position?.equals(retained.position) &&
    block.type === retained.type &&
    heldItem?.type === retained.heldItemType
  )
}

function startTimedDig(bot, state, block, plannedDigTimeMs, ticksRemaining, sendStart) {
  let resolvePromise
  let rejectPromise
  let settled = false
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const eventName = `blockUpdate:${block.position}`
  const control = {
    block,
    face: block.face,
    abortFace: block.face,
    plannedDigTimeMs,
    ticksRemaining,
    ticksElapsed: 0,
    finish: null,
    fail: null
  }

  function cleanup() {
    bot.removeListener(eventName, onBlockUpdate)
    if (state.activeDig === control) state.activeDig = null
    if (samePosition(bot.targetDigBlock, block)) {
      bot.targetDigBlock = null
      bot.targetDigFace = null
    }
    if (bot.stopDigging === stop) bot.stopDigging = state.originalStopDigging
  }

  function complete(sendFinish) {
    if (settled) return
    settled = true

    try {
      if (sendFinish) {
        bot._client.write('block_dig', {
          status: 2,
          location: block.position,
          face: control.face
        })
      }
      cleanup()
      bot.lastDigTime = performance.now()
      if (sendFinish) bot._updateBlockState(block.position, 0)
      resolvePromise()
    } catch (err) {
      cleanup()
      rejectPromise(err)
    }
  }

  function fail(err) {
    if (settled) return
    settled = true
    cleanup()
    rejectPromise(err)
  }

  function stop() {
    if (settled) return
    settled = true
    let error = new Error('Digging aborted')

    try {
      bot._client.write('block_dig', {
        status: 1,
        location: block.position,
        face: control.abortFace
      })
    } catch (err) {
      error = err
    }

    cleanup()
    bot.lastDigTime = performance.now()
    rejectPromise(error)
  }

  function onBlockUpdate(oldBlock, newBlock) {
    if (newBlock?.type === 0) complete(false)
  }

  control.finish = () => complete(true)
  control.fail = fail
  state.activeDig = control
  bot.targetDigBlock = block
  bot.targetDigFace = block.face
  bot.stopDigging = stop
  bot.on(eventName, onBlockUpdate)

  try {
    if (sendStart) {
      bot._client.write('block_dig', {
        status: 0,
        location: block.position,
        face: block.face
      })
    }
    bot.swingArm()
  } catch (err) {
    settled = true
    cleanup()
    rejectPromise(err)
  }

  return promise
}

function advanceActiveDig(bot, state) {
  const active = state.activeDig
  if (!state.running || !active) return

  try {
    active.ticksRemaining--
    active.ticksElapsed++
    if (active.ticksElapsed % 7 === 0) bot.swingArm()
    if (active.ticksRemaining <= 0) active.finish()
  } catch (err) {
    active.fail(err)
  }
}

function digWithNormalizedEnchantments(bot, state, block, attempt) {
  const restore = temporarilyNormalizeDigData(bot, block)

  try {
    const digFace = getDigFaceVector(block)
    const plannedDigTimeMs = bot.digTime(block)
    if (plannedDigTimeMs === Infinity) {
      throw new Error(`dig time for ${block.name} is Infinity`)
    }

    const retained = state.retainedDig
    const resumed = sameRetainedTarget(retained, block, bot.heldItem)
    const fullDigTicks = plannedDigTimeMs === 0
      ? 1
      : Math.max(1, Math.ceil(plannedDigTimeMs / CLIENT_TICK_MS))
    const remainingDigTicks = resumed
      ? Math.min(retained.ticksRemaining, fullDigTicks)
      : fullDigTicks

    traceRecord(state, 'dig_start', {
      attempt,
      target: blockSnapshot(bot, block),
      digFace: typeof digFace === 'string' ? digFace : vectorSnapshot(digFace),
      plannedDigTimeMs: number(plannedDigTimeMs),
      resumed,
      remainingDigTicks,
      remainingDigTimeMs: remainingDigTicks * CLIENT_TICK_MS,
      heldItem: itemSnapshot(bot.heldItem, bot.registry),
      player: {
        position: vectorSnapshot(bot.entity?.position),
        yaw: number(bot.entity?.yaw),
        pitch: number(bot.entity?.pitch),
        onGround: bot.entity?.onGround
      }
    })

    if (retained && !resumed) {
      if (retained.skipAbortOnce) {
        retained.skipAbortOnce = false
      } else {
        bot._client.write('block_dig', {
          status: 1,
          location: retained.position,
          face: block.face
        })
      }

      if (plannedDigTimeMs !== 0) {
        traceRecord(state, 'dig_progress_discarded', {
          reason: 'non_instant_retarget',
          target: {
            name: bot.registry.blocks[retained.type]?.name || null,
            type: retained.type,
            stateId: retained.stateId,
            position: vectorSnapshot(retained.position)
          },
          nextTarget: blockSnapshot(bot, block),
          remainingDigTicks: retained.ticksRemaining
        })
        state.retainedDig = null
      }
    }

    if (resumed) {
      state.retainedDig = null
      return {
        promise: startTimedDig(
          bot,
          state,
          block,
          retained.plannedDigTimeMs,
          remainingDigTicks,
          false
        ),
        plannedDigTimeMs: retained.plannedDigTimeMs
      }
    }

    // Vanilla only sends START when the initial hit destroys the block instantly.
    if (plannedDigTimeMs === 0) {
      bot._client.write('block_dig', {
        status: 0,
        location: block.position,
        face: block.face
      })
      bot.swingArm()
      bot.lastDigTime = performance.now()
      bot._updateBlockState(block.position, 0)
      return { promise: Promise.resolve(), plannedDigTimeMs }
    }

    return {
      promise: startTimedDig(bot, state, block, plannedDigTimeMs, fullDigTicks, true),
      plannedDigTimeMs
    }
  } finally {
    restore()
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
      const dig = digWithNormalizedEnchantments(bot, state, block, attempt)
      await dig.promise
      const durationMs = number(performance.now() - attemptStartedAt)
      traceRecord(state, 'dig_complete', {
        attempt,
        target: blockSnapshot(bot, block),
        durationMs
      })

      if (state.running) {
        state.completed++
        const instant = dig.plannedDigTimeMs === 0
        const delayMs = instant
          ? config.mining.instantBlockDelayMs
          : config.mining.nextBlockDelayMs

        if (delayMs > 0) {
          traceRecord(state, 'post_break_delay', {
            attempt,
            delayMs,
            instant
          })
          await sleep(delayMs)
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
  state.activeDig = null
  state.retainedDig = null
  state.originalStopDigging = bot.stopDigging
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
        instantBlockDelayMs: config.mining.instantBlockDelayMs,
        nextBlockDelayMs: config.mining.nextBlockDelayMs,
        lookAtSuppressed: true
      }
    })
    log.info(`Mining trace: ${state.traceFile}`)
  }

  startClientTickEnd(bot, () => advanceActiveDig(bot, state))
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
      stopClientTickEnd(bot)
      state.running = false
      state.currentTarget = null
      state.activeDig = null
      state.retainedDig = null
      if (state.originalStopDigging) bot.stopDigging = state.originalStopDigging
      state.originalStopDigging = null
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
  state.retainedDig = null
  stopClientTickEnd(bot)
  signalUpdate(state)

  if (state.activeDig) bot.stopDigging()

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
    instantBlockDelayMs: config.mining.instantBlockDelayMs,
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
    activeDigRemainingTicks: state.activeDig?.ticksRemaining ?? null,
    retainedDig: state.retainedDig
      ? {
          name: bot.registry.blocks[state.retainedDig.type]?.name || null,
          position: state.retainedDig.position.clone(),
          remainingTicks: state.retainedDig.ticksRemaining
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
