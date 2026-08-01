'use strict'

const { generate } = require('randomstring')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

const queue = generate()
const payload = { [generate()]: generate() }

beforeEach(() => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

it('should reject when request times out', async () => {
  await expect(io.request(queue, payload, 50)).rejects.toMatchObject({
    message: expect.stringContaining('timed out'),
    code: 'ETIMEDOUT'
  })
})

it('should reject when request times out with encoding', async () => {
  await expect(io.request(queue, payload, 'application/json', 50)).rejects.toMatchObject({
    code: 'ETIMEDOUT'
  })
})

it('should time out while send is still pending', async () => {
  connection.createChannel.mockImplementation(async () => hangingChannel())

  await expect(io.request(queue, payload, 50)).rejects.toMatchObject({
    code: 'ETIMEDOUT'
  })
})

/**
 * @returns {jest.MockedObject<comq.Channel>}
 */
function hangingChannel () {
  return /** @type {jest.MockedObject<comq.Channel>} */ ({
    sharded: false,
    consume: jest.fn(async () => undefined),
    send: jest.fn(() => new Promise(() => {})),
    deliver: jest.fn(async () => undefined),
    fire: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    diagnose: jest.fn(),
    seal: jest.fn(async () => undefined),
    recover: jest.fn(async () => undefined)
  })
}
