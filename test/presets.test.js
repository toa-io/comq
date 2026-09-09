'use strict'

const presets = require('../source/topology')

it('should define request preset', async () => {
  expect(presets.request).toStrictEqual({
    prefetch: 300,
    confirms: false,
    durable: true,
    acknowledgments: true,
    persistent: false,
    attempts: 5,
    delay: 5000
  })
})

it('should define reply preset', async () => {
  expect(presets.reply).toStrictEqual({
    prefetch: 0,
    confirms: false,
    durable: false,
    acknowledgments: false,
    persistent: false
  })
})

it('should define event preset', async () => {
  expect(presets.event).toStrictEqual({
    prefetch: 300,
    confirms: true,
    durable: true,
    acknowledgments: true,
    persistent: true,
    attempts: 5,
    delay: 30000
  })
})
