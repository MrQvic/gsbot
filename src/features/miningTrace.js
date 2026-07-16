const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

const log = require('../lib/logger')

const TRACED_OUT_PACKETS = new Set([
  'block_dig',
  'arm_animation',
  'position',
  'position_look',
  'look',
  'flying',
  'player_input',
  'held_item_slot',
  'entity_action'
])

const TRACED_IN_PACKETS = new Set([
  'acknowledge_player_digging',
  'block_change',
  'multi_block_change',
  'block_break_animation',
  'player_rotation',
  'position',
  'kick_disconnect'
])

function safeFileSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function jsonReplacer(key, value) {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }
  return value
}

function createMiningTrace(bot, options = {}) {
  if (!options.enabled) return null

  const folder = path.resolve(options.folder || './logs')
  fs.mkdirSync(folder, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `mining-${timestamp}-${safeFileSegment(bot.username)}.jsonl`
  const filePath = path.join(folder, filename)
  const stream = fs.createWriteStream(filePath, { flags: 'a' })
  const startedAt = performance.now()

  let closed = false
  let originalWrite = null
  let tracedWrite = null
  let onPacket = null

  function restoreInstrumentation() {
    if (originalWrite && bot._client?.write === tracedWrite) bot._client.write = originalWrite
    if (onPacket && typeof bot._client?.removeListener === 'function') bot._client.removeListener('packet', onPacket)
    originalWrite = null
    tracedWrite = null
    onPacket = null
  }

  function disableTrace(err) {
    if (closed) return
    closed = true
    restoreInstrumentation()
    stream.destroy()
    log.error(`Mining trace selhal: ${err.message}`)
  }

  function record(event, data = {}) {
    if (closed) return

    try {
      const entry = {
        timestamp: new Date().toISOString(),
        tMs: Number((performance.now() - startedAt).toFixed(3)),
        event,
        ...data
      }

      stream.write(`${JSON.stringify(entry, jsonReplacer)}\n`)
    } catch (err) {
      disableTrace(err)
    }
  }

  if (typeof bot._client?.write === 'function') {
    originalWrite = bot._client.write
    tracedWrite = function (name, params) {
      if (TRACED_OUT_PACKETS.has(name)) record('packet_out', { packet: name, data: params })
      return originalWrite.call(this, name, params)
    }
    bot._client.write = tracedWrite

    if (typeof bot._client.on === 'function') {
      onPacket = (data, metadata) => {
        if (TRACED_IN_PACKETS.has(metadata.name)) {
          record('packet_in', {
            packet: metadata.name,
            state: metadata.state,
            data
          })
        }
      }
      bot._client.on('packet', onPacket)
    }
  }

  stream.on('error', disableTrace)

  function close(summary = {}) {
    if (closed) return
    record('session_end', summary)
    if (closed) return
    restoreInstrumentation()
    closed = true
    stream.end()
  }

  return {
    filePath,
    get active() {
      return !closed
    },
    record,
    close
  }
}

module.exports = {
  createMiningTrace
}
