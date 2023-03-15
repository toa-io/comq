'use strict'

const channel = jest.fn(() => ({
  consume: jest.fn(async () => undefined),
  deliver: jest.fn(async () => undefined),
  send: jest.fn(async () => undefined),
  throw: jest.fn(async () => undefined),
  subscribe: jest.fn(async () => undefined),
  publish: jest.fn(async () => undefined),
  diagnose: jest.fn(async () => undefined),
  seal: jest.fn(async () => undefined),
  recover: jest.fn(async () => undefined)
}))

/**
 * @returns {jest.MockedObject<comq.Connection>}
 */
const connection = () => (/** @type {jest.MockedObject<comq.Connection>} */ {
  createChannel: jest.fn(async () => channel()),
  close: jest.fn(async () => undefined),
  diagnose: jest.fn(() => undefined)
})

exports.connection = connection
exports.channel = channel
