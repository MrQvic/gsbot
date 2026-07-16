const CLIENT_TICK_MS = 50
const timers = new WeakMap()

function startClientTickEnd(bot, onTick = null) {
  const sendsTickEnd = !bot.registry.version['<']('1.21.2')
  if (!sendsTickEnd && !onTick) return false
  if (timers.has(bot)) return true

  const onEnd = () => stopClientTickEnd(bot)
  const timer = setInterval(() => {
    onTick?.()
    if (sendsTickEnd) bot._client.write('tick_end', {})
  }, CLIENT_TICK_MS)

  timers.set(bot, { timer, onEnd })
  bot.once('end', onEnd)
  return true
}

function stopClientTickEnd(bot) {
  const state = timers.get(bot)
  if (!state) return false

  clearInterval(state.timer)
  bot.removeListener('end', state.onEnd)
  timers.delete(bot)
  return true
}

module.exports = {
  CLIENT_TICK_MS,
  startClientTickEnd,
  stopClientTickEnd
}
