function stamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

function log(level, message, ...args) {
  console.log(`[${stamp()}] [${level}] ${message}`, ...args)
}

module.exports = {
  info: (message, ...args) => log('INFO', message, ...args),
  warn: (message, ...args) => log('WARN', message, ...args),
  error: (message, ...args) => log('ERROR', message, ...args),
  debug: (message, ...args) => {
    if (process.env.DEBUG) log('DEBUG', message, ...args)
  }
}
