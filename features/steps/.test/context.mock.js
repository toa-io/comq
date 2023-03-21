'use strict'

const { comq } = require('./comq.mock')

const connect = jest.fn(() => comq.connect())
const disconnect = jest.fn(async () => undefined)

/**
 * @return {jest.MockedObject<comq.features.Context>}
 */
exports.context = () => (/** @type {jest.MockedObject<comq.features.Context>} */{
  connect,
  disconnect
})
