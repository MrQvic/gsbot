const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createBotController } = require('../src/botController')

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function createHarness(delaysMs = [5]) {
  const bots = []
  const messages = []

  const controller = createBotController({
    createBot: () => {
      const bot = new EventEmitter()
      bot.quit = reason => {
        bot.quitReason = reason
        bot.emit('end', reason)
      }
      bots.push(bot)
      return bot
    },
    reconnect: {
      enabled: true,
      delaysMs
    },
    connectionLabel: 'test-server',
    log: {
      info: message => messages.push({ level: 'info', message }),
      warn: message => messages.push({ level: 'warn', message }),
      error: message => messages.push({ level: 'error', message })
    }
  })

  return { controller, bots, messages }
}

test('unexpected end creates a fresh bot after the configured delay', async () => {
  const { controller, bots } = createHarness()

  controller.start()
  assert.equal(bots.length, 1)
  assert.equal(controller.getStatus().state, 'CONNECTING')

  bots[0].emit('spawn')
  assert.equal(controller.getStatus().state, 'ONLINE')

  bots[0].emit('kicked', 'server restart')
  bots[0].emit('end', 'socketClosed')
  assert.equal(controller.getStatus().state, 'WAITING_RECONNECT')

  await wait(15)
  assert.equal(bots.length, 2)
  assert.equal(controller.getBot(), bots[1])
  assert.equal(controller.getStatus().state, 'CONNECTING')

  bots[1].emit('spawn')
  assert.equal(controller.getStatus().state, 'ONLINE')
  assert.equal(controller.getStatus().retryIndex, 0)
  assert.equal(controller.getStatus().lastDisconnect.kickReason, 'server restart')
})

test('shutdown cancels reconnect and an end event cannot start a new bot', async () => {
  const { controller, bots } = createHarness()

  controller.start()
  bots[0].emit('spawn')
  controller.shutdown('test shutdown')

  assert.equal(controller.getStatus().state, 'OFFLINE')
  assert.equal(bots[0].quitReason, 'test shutdown')

  await wait(15)
  assert.equal(bots.length, 1)
  assert.equal(controller.getBot(), null)
})

test('connection failures use later delays until a spawn resets backoff', async () => {
  const { controller, bots } = createHarness([5, 10])

  controller.start()
  bots[0].emit('end', 'first failure')
  assert.equal(controller.getStatus().retryIndex, 1)

  await wait(8)
  assert.equal(bots.length, 2)
  bots[1].emit('end', 'second failure')
  assert.equal(controller.getStatus().retryIndex, 2)

  await wait(15)
  assert.equal(bots.length, 3)
  bots[2].emit('spawn')
  assert.equal(controller.getStatus().retryIndex, 0)

  controller.shutdown('test cleanup')
})
