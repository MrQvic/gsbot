const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const test = require('node:test')

process.env.MINING_TRACE = 'false'

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'dotenv') return { config() {} }
  return originalLoad.call(this, request, parent, isMain)
}
const {
  getContinuousMiningStatus,
  startContinuousMining
} = require('../src/features/continuousMining')
Module._load = originalLoad

class TestVector {
  constructor(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
  }

  clone() {
    return new TestVector(this.x, this.y, this.z)
  }

  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  offset(x, y, z) {
    return new TestVector(this.x + x, this.y + y, this.z + z)
  }

  normalize() {
    const length = Math.hypot(this.x, this.y, this.z)
    if (length > 0) this.set(this.x / length, this.y / length, this.z / length)
    return this
  }

  equals(other) {
    return this.x === other.x && this.y === other.y && this.z === other.z
  }

  distanceTo(other) {
    return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z)
  }
}

function createMiningBot() {
  const bot = new EventEmitter()
  const packets = []
  const block = {
    name: 'stone',
    type: 1,
    stateId: 1,
    material: 'stone',
    harvestTools: { 100: true },
    position: new TestVector(0, 65, -2),
    face: 3,
    intersect: new TestVector(0.5, 65.5, -1),
    diggable: true
  }
  const client = new EventEmitter()
  client.write = (name, params) => packets.push({ name, params })

  bot._client = client
  bot.registry = {
    version: { '<': () => false },
    materials: { stone: { 100: 1 } },
    blocks: { 1: { name: 'stone' } },
    enchantments: []
  }
  bot.entity = {
    position: new TestVector(0, 64, 0),
    eyeHeight: 1.62,
    height: 1.8,
    yaw: 0,
    pitch: 0,
    onGround: true,
    effects: {}
  }
  bot.world = { raycast: () => block }
  bot.heldItem = { name: 'diamond_pickaxe', type: 100, count: 1 }
  bot.inventory = { slots: [] }
  bot.game = { gameMode: 'survival', dimension: 'overworld' }
  bot.username = 'test-bot'
  bot.version = '1.21.11'
  bot.protocolVersion = 774
  bot.physicsEnabled = true
  bot.canDigBlock = () => true
  bot.digTime = () => 1000
  bot.getEquipmentDestSlot = () => undefined
  bot.lookAt = async () => {}
  bot.swingArm = () => bot._client.write('arm_animation', {})
  bot._updateBlockState = () => {}
  bot.stopDigging = () => {}

  return { bot, client, packets }
}

test('world change tears mining down without stale outbound packets', async () => {
  const { bot, client, packets } = createMiningBot()
  const originalStopDigging = bot.stopDigging

  const started = startContinuousMining(bot)
  assert.equal(started.ok, true)
  assert.equal(getContinuousMiningStatus(bot).running, true)

  client.emit('respawn', {
    worldName: 'minecraft:the_nether',
    dimension: 'minecraft:the_nether'
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(getContinuousMiningStatus(bot).running, false)
  assert.equal(bot.stopDigging, originalStopDigging)
  assert.equal(client.listenerCount('respawn'), 0)
  assert.deepEqual(
    packets.filter(packet => packet.name === 'block_dig').map(packet => packet.params.status),
    [0]
  )
  assert.equal(packets.some(packet => packet.name === 'tick_end'), false)
})
