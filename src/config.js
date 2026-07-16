require('dotenv').config({ quiet: true })

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function envBoolean(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase())
}

function envVersion(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (['auto', 'false'].includes(String(raw).toLowerCase())) return false
  return raw
}

module.exports = {
  connection: {
    host: process.env.MC_HOST || 'mc.goldskyblock.cz',
    port: envNumber('MC_PORT', 25565),
    username: process.env.MC_USERNAME || 'CHANGE_ME',
    auth: process.env.MC_AUTH || 'microsoft',
    profilesFolder: process.env.MC_PROFILES_FOLDER || './aut_cache',

    version: envVersion('MC_VERSION', '1.21.11'),
    checkTimeoutInterval: envNumber('MC_KEEPALIVE_TIMEOUT_MS', 60000),

    // Dulezite: protodef jinak umi primo pres console.log spamovat PartialReadError
    // u packet_world_particles jeste predtim, nez se chyba dostane do naseho loggeru.
    hideErrors: envBoolean('MC_HIDE_PROTOCOL_ERRORS', true),

    // Vlastni error logging mame v src/events.js, at mineflayer neloguje duplicitni stack traces.
    logErrors: false
  },

  lobbyTransfer: {
    enabled: envBoolean('LOBBY_AUTO', true),

    // Bezpecnostni podminky z puvodniho JsMacros skriptu.
    // Nastav LOBBY_REMOTE_ADDRESS prazdne, pokud nechces kontrolovat IP.
    onlyRemoteAddress: process.env.LOBBY_REMOTE_ADDRESS || '185.180.2.13',
    onlyWhenY: envNumber('LOBBY_Y', 112),

    // Hotbar slot je 0-8. Puvodni inv.setSelectedHotbarSlotIndex(4) = pátý slot.
    hotbarSlot: envNumber('LOBBY_SELECTOR_SLOT', 4),
    expectedItemName: process.env.LOBBY_SELECTOR_ITEM || 'nether_star',
    expectedNameIncludes: process.env.LOBBY_SELECTOR_NAME || 'Výběr serveru',

    // Slot v otevrenem menu. Puvodni menu.click(11, 1).
    menuSlot: envNumber('LOBBY_MENU_SLOT', 11),
    mouseButton: envNumber('LOBBY_MOUSE_BUTTON', 1),
    clickMode: envNumber('LOBBY_CLICK_MODE', 0),

    // Kdyz je prazdne, bot po kliknuti v menu neceka na potvrzovaci chat zpravu.
    successMessageIncludes: process.env.LOBBY_SUCCESS_MESSAGE || '',
    initialDelayMs: envNumber('LOBBY_INITIAL_DELAY_MS', 1000),
    selectDelayMs: envNumber('LOBBY_SELECT_DELAY_MS', 150),
    windowTimeoutMs: envNumber('LOBBY_WINDOW_TIMEOUT_MS', 5000),
    menuClickDelayMs: envNumber('LOBBY_MENU_CLICK_DELAY_MS', 500),
    successTimeoutMs: envNumber('LOBBY_SUCCESS_TIMEOUT_MS', 4000)
  },

  mining: {
    instantBlockDelayMs: Math.max(0, envNumber('MINING_INSTANT_BLOCK_DELAY_MS', 50)),
    nextBlockDelayMs: Math.max(0, envNumber('MINING_NEXT_BLOCK_DELAY_MS', 250)),
    traceEnabled: envBoolean('MINING_TRACE', false),
    traceFolder: process.env.MINING_TRACE_FOLDER || './logs'
  },

  viewer: {
    enabled: envBoolean('VIEWER_ENABLED', false),
    port: envNumber('VIEWER_PORT', 3000),
    viewDistance: envNumber('VIEWER_VIEW_DISTANCE', 6),
    firstPerson: envBoolean('VIEWER_FIRST_PERSON', false),
    publicHost: process.env.VIEWER_PUBLIC_HOST || 'localhost'
  }
}
