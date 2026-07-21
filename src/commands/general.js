const { runLobbyTransfer, getItemDisplayText } = require('../features/lobbyTransfer')

function formatPosition(bot) {
  const pos = bot.entity?.position
  if (!pos) return 'neznam pozici'
  return `x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)} z=${pos.z.toFixed(1)}`
}

function getCurrentBot(controller, reply) {
  const bot = controller.getBot()
  if (bot) return bot

  reply(`Bot neni pripojeny (stav=${controller.getStatus().state}).`)
  return null
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString('cs-CZ') : 'none'
}

function registerGeneralCommands(registry, controller) {
  registry.register({
    name: 'help',
    aliases: ['h', '?'],
    description: 'Vypise dostupne prikazy',
    usage: 'help',
    run: ({ reply, registry }) => {
      const lines = registry.list().map(cmd => {
        const usage = cmd.usage || cmd.name
        const description = cmd.description ? ` - ${cmd.description}` : ''
        return `${usage}${description}`
      })
      reply(lines.join('\n'))
    }
  })

  registry.register({
    name: 'status',
    aliases: ['s'],
    description: 'Zakladni stav bota',
    usage: 'status',
    run: ({ reply }) => {
      const bot = controller.getBot()
      const connection = controller.getStatus()
      reply([
        `connection=${connection.state}`,
        `nextReconnect=${formatTimestamp(connection.reconnectAt)}`,
        `reconnectAttempt=${connection.retryIndex}`,
        `lastDisconnect=${formatTimestamp(connection.lastDisconnect?.at)}`,
        `lastDisconnectReason=${connection.lastDisconnect?.kickReason || connection.lastDisconnect?.endReason || connection.lastDisconnect?.error || 'none'}`,
        `username=${bot?.username || 'unknown'}`,
        `health=${bot?.health ?? 'unknown'}`,
        `food=${bot?.food ?? 'unknown'}`,
        `gameMode=${bot?.game?.gameMode || 'unknown'}`,
        `dimension=${bot?.game?.dimension || 'unknown'}`,
        `pos=${bot ? formatPosition(bot) : 'neznam pozici'}`
      ].join('\n'))
    }
  })

  registry.register({
    name: 'pos',
    description: 'Vypise aktualni pozici',
    usage: 'pos',
    run: ({ reply }) => {
      const bot = getCurrentBot(controller, reply)
      if (bot) reply(formatPosition(bot))
    }
  })

  registry.register({
    name: 'say',
    description: 'Posle zpravu do Minecraft chatu',
    usage: 'say <text>',
    run: ({ args, reply }) => {
      const message = args.join(' ')
      if (!message) return reply('Pouziti: say <text>')
      const bot = getCurrentBot(controller, reply)
      if (!bot) return
      if (typeof bot.chat !== 'function') return reply('Bot jeste neni pripraveny posilat chat.')
      bot.chat(message)
    }
  })

  registry.register({
    name: 'lobby',
    aliases: ['server'],
    description: 'Rucne spusti prepojeni z lobby pres nether star',
    usage: 'lobby [force]',
    run: async ({ args, reply }) => {
      const bot = getCurrentBot(controller, reply)
      if (!bot) return
      const force = args.includes('force')
      const ok = await runLobbyTransfer(bot, { force })
      reply(ok ? 'Lobby transfer hotovy.' : 'Lobby transfer se nepovedl / byl preskocen.')
    }
  })

  registry.register({
    name: 'slot',
    description: 'Vybere hotbar slot 0-8',
    usage: 'slot <0-8>',
    run: ({ args, reply }) => {
      const slot = Number(args[0])
      if (!Number.isInteger(slot) || slot < 0 || slot > 8) return reply('Pouziti: slot <0-8>')
      const bot = getCurrentBot(controller, reply)
      if (!bot) return

      if (typeof bot.setQuickBarSlot === 'function') bot.setQuickBarSlot(slot)
      else bot.quickBarSlot = slot

      reply(`Vybran hotbar slot ${slot}.`)
    }
  })

  registry.register({
    name: 'held',
    aliases: ['item'],
    description: 'Vypise item v ruce',
    usage: 'held',
    run: ({ reply }) => {
      const bot = getCurrentBot(controller, reply)
      if (!bot) return
      const item = bot.heldItem
      if (!item) return reply('V ruce nic neni.')
      reply(`${item.name} x${item.count || 1}\n${getItemDisplayText(item)}`)
    }
  })

  registry.register({
    name: 'use',
    description: 'Pouzije item v ruce',
    usage: 'use',
    run: ({ reply }) => {
      const bot = getCurrentBot(controller, reply)
      if (!bot) return
      bot.activateItem()
      reply('Pouzivam item v ruce.')
    }
  })

  registry.register({
    name: 'quit',
    aliases: ['exit'],
    description: 'Odpoji bota a ukonci proces',
    usage: 'quit',
    run: ({ reply }) => {
      reply('Ukoncuju bota...')
      controller.shutdown('quit command')
      setTimeout(() => process.exit(0), 500)
    }
  })
}

module.exports = {
  registerGeneralCommands
}
