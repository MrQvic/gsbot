function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForEvent(emitter, eventName, timeoutMs, filter = () => true) {
  return new Promise((resolve, reject) => {
    let timer = null

    function cleanup() {
      if (timer) clearTimeout(timer)
      emitter.removeListener(eventName, handler)
    }

    function handler(...args) {
      try {
        if (!filter(...args)) return
        cleanup()
        resolve(args.length <= 1 ? args[0] : args)
      } catch (err) {
        cleanup()
        reject(err)
      }
    }

    if (timeoutMs !== undefined && timeoutMs !== null) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for event '${eventName}'`))
      }, timeoutMs)
    }

    emitter.on(eventName, handler)
  })
}

module.exports = {
  sleep,
  waitForEvent
}
