const readline = require('readline')
const log = require('./lib/logger')

function startConsole(registry, context = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  })

  const reply = (message) => {
    if (message !== undefined && message !== null) console.log(String(message))
  }

  rl.on('line', async line => {
    await registry.execute(line, {
      ...context,
      source: 'console',
      reply
    })
    rl.prompt()
  })

  rl.on('SIGINT', () => {
    log.info('CTRL+C: ukoncuju...')
    context.bot?.quit?.('SIGINT')
    process.exit(0)
  })

  log.info('Konzole pripravena. Napis help pro prikazy.')
  rl.prompt()

  return rl
}

module.exports = {
  startConsole
}
