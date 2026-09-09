'use strict'

const { random, flip } = require('./helpers')

const preset = () => ({
  prefetch: random(10),
  confirms: flip(),
  durable: flip(),
  acknowledgments: flip(),
  persistent: flip(),
  delay: [1000, 1000, 1000, 1000]
})

exports.preset = preset
