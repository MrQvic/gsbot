function injectInteractionSequence(bot) {
  if (bot.registry.version['<']('1.19')) return

  let sequence = 0
  let worldName = null
  const originalWrite = bot._client.write

  function getWorldName(packet) {
    const worldState = packet.worldState || packet
    return worldState.name || worldState.worldName || null
  }

  function resetSequence() {
    sequence = 0
  }

  function nextSequence() {
    sequence = (sequence + 1) | 0
    return sequence
  }

  bot._client.on('login', packet => {
    resetSequence()
    worldName = getWorldName(packet)
  })

  bot._client.on('respawn', packet => {
    const nextWorldName = getWorldName(packet)
    if (nextWorldName !== null && nextWorldName !== worldName) resetSequence()
    if (nextWorldName !== null) worldName = nextWorldName
  })

  bot._client.write = function (name, params) {
    if (name === 'block_dig') {
      params.sequence = params.status === 0 || params.status === 2 ? nextSequence() : 0
    } else if (name === 'block_place' || name === 'use_item') {
      params.sequence = nextSequence()
    }

    return originalWrite.call(this, name, params)
  }
}

module.exports = {
  injectInteractionSequence
}
