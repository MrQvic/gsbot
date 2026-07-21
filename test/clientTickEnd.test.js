const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { startClientTickEnd, stopClientTickEnd } = require('../src/features/clientTickEnd')

function createBot({ supportsTickEnd = true } = {}) {
  const bot = new EventEmitter()
  const packets = []

  bot.registry = {
    version: {
      '<': version => version === '1.21.2' && !supportsTickEnd
    }
  }
  bot._client = {
    write(name, params) {
      packets.push({ name, params })
    }
  }

  return { bot, packets }
}

async function drainMicrotasks() {
  await Promise.resolve()
}

test('closes a physics tick after mining and movement packets', async () => {
  const { bot, packets } = createBot()

  startClientTickEnd(bot, () => {
    bot._client.write('block_dig', { status: 2 })
  })
  bot.on('physicsTick', () => {
    bot._client.write('position', { x: 1 })
  })

  bot.emit('physicsTick')
  await drainMicrotasks()

  assert.deepEqual(packets.map(packet => packet.name), [
    'block_dig',
    'position',
    'tick_end'
  ])
  stopClientTickEnd(bot)
})

test('separates synchronous catch-up physics ticks', async () => {
  const { bot, packets } = createBot()

  startClientTickEnd(bot)
  bot.on('physicsTick', () => {
    bot._client.write('flying', { onGround: true })
  })

  bot.emit('physicsTick')
  bot.emit('physicsTick')
  await drainMicrotasks()

  assert.deepEqual(packets.map(packet => packet.name), [
    'flying',
    'tick_end',
    'flying',
    'tick_end'
  ])
  stopClientTickEnd(bot)
})

test('never allows two movement packets inside one boundary', async () => {
  const { bot, packets } = createBot()

  startClientTickEnd(bot)
  bot._client.write('position', { x: 1 })
  bot._client.write('look', { yaw: 1 })
  await drainMicrotasks()

  assert.deepEqual(packets.map(packet => packet.name), [
    'position',
    'tick_end',
    'look',
    'tick_end'
  ])
  stopClientTickEnd(bot)
})

test('flushes a manual stop but drops an unsafe lifecycle boundary', async () => {
  const flushed = createBot()
  startClientTickEnd(flushed.bot)
  flushed.bot._client.write('block_dig', { status: 1 })
  stopClientTickEnd(flushed.bot, { flush: true })
  await drainMicrotasks()

  assert.deepEqual(flushed.packets.map(packet => packet.name), [
    'block_dig',
    'tick_end'
  ])

  const dropped = createBot()
  startClientTickEnd(dropped.bot)
  dropped.bot._client.write('block_dig', { status: 1 })
  stopClientTickEnd(dropped.bot, { flush: false })
  await drainMicrotasks()

  assert.deepEqual(dropped.packets.map(packet => packet.name), ['block_dig'])
})

test('keeps mining ticks on older protocols without sending tick_end', async () => {
  const { bot, packets } = createBot({ supportsTickEnd: false })
  let ticks = 0

  startClientTickEnd(bot, () => ticks++)
  bot.emit('physicsTick')
  await drainMicrotasks()

  assert.equal(ticks, 1)
  assert.deepEqual(packets, [])
  stopClientTickEnd(bot)
})
