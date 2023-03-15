'use strict'

const { random, flip } = require('@toa.io/generic')

const preset = () => ({
  prefetch: random(10),
  confirms: flip(),
  durable: flip(),
  acknowledgements: flip(),
  persistent: flip()
})

exports.preset = preset
