const config = require('../config')
const log = require('../lib/logger')
const { sleep, waitForEvent } = require('../lib/wait')

function normalizeItemName(name) {
  if (!name) return ''
  return String(name).replace(/^minecraft:/, '')
}

function stringifySafe(value) {
  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function getItemDisplayText(item) {
  if (!item) return ''

  const parts = [
    item.name,
    item.displayName,
    item.customName,
    item.customLore,
    item.nbt
  ].filter(Boolean)

  return parts.map(stringifySafe).join(' ')
}

function isExpectedSelector(item, cfg) {
  if (!item) return false

  const itemName = normalizeItemName(item.name)
  const expectedItemName = normalizeItemName(cfg.expectedItemName)
  if (expectedItemName && itemName !== expectedItemName) return false

  const expectedText = cfg.expectedNameIncludes
  if (!expectedText) return true

  return getItemDisplayText(item).includes(expectedText)
}

function getRemoteAddress(bot) {
  return bot?._client?.socket?.remoteAddress || bot?._client?.socket?._host || ''
}

function getMessagestrText(message) {
  if (typeof message === 'string') return message
  if (message && typeof message.toString === 'function') return message.toString()
  return String(message || '')
}

async function waitForMessageIncludes(bot, needle, timeoutMs) {
  if (!needle) return null

  const result = await waitForEvent(
    bot,
    'messagestr',
    timeoutMs,
    message => getMessagestrText(message).includes(needle)
  )

  return Array.isArray(result) ? result[0] : result
}

function shouldRunInThisWorld(bot, cfg, force) {
  if (force) return true

  const y = bot.entity?.position?.y
  if (cfg.onlyWhenY !== null && cfg.onlyWhenY !== undefined) {
    if (Math.floor(y) !== cfg.onlyWhenY) {
      log.info(`Lobby transfer preskakuju: Y=${Math.floor(y)} != ${cfg.onlyWhenY}`)
      return false
    }
  }

  if (cfg.onlyRemoteAddress) {
    const remoteAddress = getRemoteAddress(bot)
    const host = bot.options?.host || ''
    const matches = remoteAddress.includes(cfg.onlyRemoteAddress) || host.includes(cfg.onlyRemoteAddress)

    if (!matches) {
      log.info(`Lobby transfer preskakuju: remoteAddress='${remoteAddress}', host='${host}'`)
      return false
    }
  }

  return true
}

async function runLobbyTransfer(bot, options = {}) {
  const cfg = {
    ...config.lobbyTransfer,
    ...options
  }

  const force = Boolean(options.force)

  if (!cfg.enabled && !force) {
    log.info('Lobby transfer je vypnuty (LOBBY_AUTO=false).')
    return false
  }

  if (!bot.entity) {
    log.warn('Lobby transfer nejde spustit: bot jeste neni ve svete.')
    return false
  }

  if (!shouldRunInThisWorld(bot, cfg, force)) return false

  log.info('Spoustim lobby transfer pres nether star...')
  await sleep(cfg.initialDelayMs)

  if (typeof bot.setQuickBarSlot === 'function') {
    bot.setQuickBarSlot(cfg.hotbarSlot)
  } else {
    bot.quickBarSlot = cfg.hotbarSlot
  }

  await sleep(cfg.selectDelayMs)

  const held = bot.heldItem
  if (!isExpectedSelector(held, cfg)) {
    log.warn(`V ruce neni ocekavany selector: item=${held ? held.name : 'nic'}`)
    log.debug(`Held item detail: ${getItemDisplayText(held)}`)
    return false
  }

  const windowPromise = waitForEvent(bot, 'windowOpen', cfg.windowTimeoutMs)
  bot.activateItem()

  let window
  try {
    window = await windowPromise
  } catch (err) {
    log.warn(`Menu se neotevrelo: ${err.message}`)
    return false
  }

  log.info(`Menu otevreno: ${window?.title || 'bez nazvu'}; klikam slot ${cfg.menuSlot}`)
  await sleep(cfg.menuClickDelayMs)

  try {
    await bot.clickWindow(cfg.menuSlot, cfg.mouseButton, cfg.clickMode)
  } catch (err) {
    log.warn(`Kliknuti v menu selhalo: ${err.message}`)
    return false
  }

  try {
    await waitForMessageIncludes(bot, cfg.successMessageIncludes, cfg.successTimeoutMs)
    log.info(`Lobby transfer vypada uspesne: zachycena zprava '${cfg.successMessageIncludes}'.`)
    return true
  } catch (err) {
    log.warn(`Nepotvrzeno zprávou '${cfg.successMessageIncludes}' do ${cfg.successTimeoutMs} ms.`)

    try {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
    } catch (_) {}

    return false
  }
}

module.exports = {
  runLobbyTransfer,
  isExpectedSelector,
  getRemoteAddress,
  getItemDisplayText
}
