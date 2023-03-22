'use strict'

const channel = /** @type {jest.MockedFunction<(sharded?: boolean, index?: number) => comq.Channel>} */ jest.fn(
  (sharded = false, index = undefined) => ({
    index,
    sharded,
    consume: jest.fn(async () => undefined),
    deliver: jest.fn(async () => undefined),
    send: jest.fn(async () => undefined),
    fire: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    diagnose: jest.fn(async () => undefined),
    seal: jest.fn(async () => undefined),
    recover: jest.fn(async () => undefined)
  }))

/**
 * @returns {jest.MockedObject<comq.Connection>}
 */
const connection = (sharded = false) => (/** @type {jest.MockedObject<comq.Connection>} */ {
  createChannel: jest.fn(async (type, index) => channel(sharded, index)),
  open: jest.fn(async () => undefined),
  close: jest.fn(async () => undefined),
  diagnose: jest.fn(() => undefined)
})

exports.connection = connection
exports.channel = channel
