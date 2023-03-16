'use strict'

const { generate } = require('randomstring')

const connect = jest.fn(async () => generate())
const disconnect = jest.fn(async () => undefined)

/**
 * @return {jest.MockedObject<comq.features.Context>}
 */
exports.context = () => (/** @type {jest.MockedObject<comq.features.Context>} */{
  connect,
  disconnect
})
