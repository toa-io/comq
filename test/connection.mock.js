'use strict'

const channel = /** @type {jest.MockedFunction<(sharded?: boolean, index?: number) => jest.MockedObject<comq.Channel>>} */ jest.fn(
  (sharded = false, index = undefined) => ({
    index,
    sharded,
    consume: jest.fn(async () => undefined),
    deliver: jest.fn(async () => undefined),
    // a sharded channel tells which shard a message goes through, the first one unless told otherwise
    send: jest.fn(async (_queue, _buffer, _options, via) => { if (sharded) via?.(0) }),
    fire: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    bound: jest.fn(async () => undefined),
    held: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    route: jest.fn(async (_exchange, _key, _buffer, _options, via) => { if (sharded) via?.(0) }),
    diagnose: jest.fn(async () => undefined),
    forget: jest.fn(() => undefined),
    seal: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
    closed: false,
    recover: jest.fn(async () => undefined)
  }))

/**
 * @returns {jest.MockedObject<comq.Connection>}
 */
const connection = (sharded = false) => (/** @type {jest.MockedObject<comq.Connection>} */ {
  connected: true,
  closed: false,
  createChannel: jest.fn(async (type, index) => channel(sharded, index)),
  open: jest.fn(async () => undefined),
  close: jest.fn(async () => undefined),
  diagnose: jest.fn(() => undefined),
  forget: jest.fn(() => undefined)
})

exports.connection = connection
exports.channel = channel
