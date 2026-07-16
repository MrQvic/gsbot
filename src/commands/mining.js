const {
  startContinuousMining,
  stopContinuousMining,
  getContinuousMiningStatus
} = require('../features/continuousMining')

function formatTarget(target) {
  if (!target) return 'zadny'
  const pos = target.position
  return `${target.name} (${pos.x}, ${pos.y}, ${pos.z})`
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)} s`
}

function formatStatus(status) {
  return [
    `running=${status.running ? 'true' : 'false'}`,
    `held=${status.heldItem || 'nothing'}`,
    `instantBlockDelayMs=${status.instantBlockDelayMs}`,
    `nextBlockDelayMs=${status.nextBlockDelayMs}`,
    `traceEnabled=${status.traceEnabled ? 'true' : 'false'}`,
    `traceActive=${status.traceActive ? 'true' : 'false'}`,
    `traceFile=${status.traceFile || 'none'}`,
    `directionLocked=${status.directionLocked ? 'true' : 'false'}`,
    `lookAtSuppressed=${status.lookAtSuppressed ? 'true' : 'false'}`,
    `cursor=${formatTarget(status.cursor)}`,
    `cursorDiggable=${status.cursor?.diggable ? 'true' : 'false'}`,
    `lockedCursor=${formatTarget(status.lockedCursor)}`,
    `lockedCursorDiggable=${status.lockedCursor?.diggable ? 'true' : 'false'}`,
    `target=${formatTarget(status.target)}`,
    `elapsed=${formatDuration(status.elapsedMs)}`,
    `completed=${status.completed}`,
    `aborted=${status.aborted}`,
    `retargets=${status.retargets}`,
    `errors=${status.errors}`,
    `lastBlock=${status.lastBlockName || 'none'}`,
    `lastError=${status.lastError || 'none'}`
  ].join('\n')
}

function registerMiningCommands(registry, bot) {
  registry.register({
    name: 'mine',
    aliases: ['mining'],
    description: 'Ovlada prubeznou tezbu bloku pod kurzorem',
    usage: 'mine <start|stop|status>',
    run: async ({ args, reply }) => {
      const action = (args[0] || 'status').toLowerCase()

      if (['status', 'info'].includes(action)) {
        return reply(formatStatus(getContinuousMiningStatus(bot)))
      }

      if (['start', 'on'].includes(action)) {
        const result = startContinuousMining(bot)
        if (!result.ok) return reply(result.message)
        return reply(result.already ? 'Tezba uz bezi.' : 'Tezba spustena.')
      }

      if (['stop', 'off'].includes(action)) {
        const result = await stopContinuousMining(bot)
        return reply(result.ok ? 'Tezba zastavena.' : result.message)
      }

      return reply('Pouziti: mine <start|stop|status>')
    }
  })
}

module.exports = {
  registerMiningCommands
}
