'use strict'

// region setup

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { immediate } = require('./helpers')
const { encode } = require('../source/encode')
const { Unroutable } = require('../source/unroutable')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

/** @type {jest.MockedObject<comq.Channel>} */
let requests

/** @type {jest.MockedObject<comq.Channel>} */
let replies

const exchange = generate()
const key = generate()
const payload = { [generate()]: generate() }

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

// endregion

describe('call', () => {
  /** @type {Promise<any>} */
  let promise

  beforeEach(async () => {
    promise = io.call(exchange, key, payload)

    // allows initializers to run
    await immediate()

    requests = await findChannel('request')
    replies = await findChannel('reply')
  })

  it('should publish to the exchange under the key', async () => {
    expect(requests.route).toHaveBeenCalledWith(exchange, key, expect.any(Buffer),
      expect.objectContaining({ mandatory: true }))
  })

  it('should declare no queue to publish to', async () => {
    expect(requests.send).not.toHaveBeenCalled()
  })

  it('should consume the queue it is answered to', async () => {
    const properties = requests.route.mock.calls[0][3]

    expect(replies.consume).toHaveBeenCalledWith(properties.replyTo, expect.any(Function))
  })

  it('should resolve with the reply', async () => {
    const content = randomBytes(8)
    const { correlationId } = requests.route.mock.calls[0][3]
    const deliver = replies.consume.mock.calls[0][1]

    await deliver({ content, properties: { correlationId } })

    await expect(promise).resolves.toStrictEqual(content)
  })

  it('should reject with Unroutable once the broker returns it', async () => {
    const properties = requests.route.mock.calls[0][3]

    emit(requests, 'return', { content: randomBytes(8), fields: { exchange, routingKey: key }, properties })

    await expect(promise).rejects.toBeInstanceOf(Unroutable)
    await expect(promise).rejects.toMatchObject({ exchange, key })
  })

  it('should leave it waiting when another Request is returned', async () => {
    const settled = jest.fn()
    const properties = { ...requests.route.mock.calls[0][3], correlationId: generate() }

    promise.then(settled, settled)

    emit(requests, 'return', { content: randomBytes(8), fields: { exchange, routingKey: key }, properties })

    await immediate()

    expect(settled).not.toHaveBeenCalled()
  })
})

describe('timeout', () => {
  it('should stop waiting while the channels are being created', async () => {
    connection.createChannel.mockImplementation(() => new Promise(() => undefined))

    const promise = io.call(exchange, key, payload, { timeout: 20 })

    await expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

describe('back', () => {
  const producer = jest.fn(() => generate())

  beforeEach(async () => {
    await io.back(exchange, key, producer)

    requests = await findChannel('request')
  })

  it('should hold a queue named after the exchange and the key', async () => {
    expect(requests.held).toHaveBeenCalledWith(exchange, `${exchange}.${key}`, key, expect.any(Function))
  })

  it('should answer a Request', async () => {
    const consumer = requests.held.mock.calls[0][3]
    const contentType = 'application/json'
    const properties = { contentType, correlationId: generate(), replyTo: generate() }

    await consumer({ content: encode(payload, contentType), properties })

    replies = await findChannel('reply')

    expect(producer).toHaveBeenCalledWith(payload)

    expect(replies.fire).toHaveBeenCalledWith(properties.replyTo, expect.any(Buffer),
      expect.objectContaining({ correlationId: properties.correlationId }))
  })
})

/**
 * @param {comq.topology.type} type
 * @returns {jest.MockedObject<comq.Channel>}
 */
const findChannel = (type) => {
  const index = connection.createChannel.mock.calls.findIndex(([t]) => (t === type))

  if (index === -1) throw new Error(`${type} channel hasn't been created`)

  return connection.createChannel.mock.results[index].value
}

/**
 * @param {jest.MockedObject<comq.Channel>} channel
 * @param {string} event
 * @param {...any} args
 */
function emit (channel, event, ...args) {
  for (const [name, listener] of channel.diagnose.mock.calls) {
    if (name === event) listener(...args)
  }
}
