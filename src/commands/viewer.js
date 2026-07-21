const { startViewer, stopViewer, getViewerStatus } = require('../features/viewer')

function formatOptions(options) {
  return [
    `port=${options.port}`,
    `viewDistance=${options.viewDistance}`,
    `firstPerson=${options.firstPerson ? 'true' : 'false'}`
  ].join(' ')
}

function formatStatus(status) {
  if (status.running) {
    return `Viewer bezi: ${status.url}\n${formatOptions(status.options)}`
  }

  if (status.starting) return 'Viewer se prave startuje.'
  return `Viewer nebezi. Spustis ho prikazem: viewer start [port]\n${formatOptions(status.options)}`
}

function parsePort(raw) {
  if (raw === undefined) return { ok: true, port: undefined }

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'Port musi byt cele cislo 1-65535.' }
  }

  return { ok: true, port }
}

function registerViewerCommands(registry, controller) {
  registry.register({
    name: 'viewer',
    aliases: ['view', 'map'],
    description: 'Ovlada webovy Prismarine viewer',
    usage: 'viewer <start|stop|status> [port]',
    run: async ({ args, reply }) => {
      const action = (args[0] || 'status').toLowerCase()
      const bot = controller.getBot()
      if (!bot) return reply(`Bot neni pripojeny (stav=${controller.getStatus().state}).`)

      if (['status', 'info'].includes(action)) {
        return reply(formatStatus(getViewerStatus(bot)))
      }

      if (['start', 'on'].includes(action)) {
        const parsed = parsePort(args[1])
        if (!parsed.ok) return reply(parsed.message)

        const result = await startViewer(bot, parsed.port ? { port: parsed.port } : {})
        if (!result.ok) return reply(result.message)
        return reply(result.already ? `Viewer uz bezi: ${result.url}` : `Viewer spusten: ${result.url}`)
      }

      if (['stop', 'off'].includes(action)) {
        const result = stopViewer(bot)
        return reply(result.ok ? 'Viewer zastaven.' : result.message)
      }

      return reply('Pouziti: viewer <start|stop|status> [port]')
    }
  })
}

module.exports = {
  registerViewerCommands
}
