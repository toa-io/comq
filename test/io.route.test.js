'use strict'

const { generate } = require('randomstring')

const { decode } = require('../source/decode')
const { encode } = require('../source/encode')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

/** @type {jest.MockedObject<comq.Channel>} */
let events

const exchange = generate()
const queue = generate()
const key = generate()
const payload = generate()

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

describe('route', () => {
  beforeEach(async () => {
    await io.route(exchange, key, payload)

    events = await connection.createChannel.mock.results[0].value
  })

  it('should create an event channel', async () => {
    expect(connection.createChannel).toHaveBeenCalledWith('event')
  })

  it('should route to the exchange under the key', async () => {
    expect(events.route).toHaveBeenCalledTimes(1)

    const [name, routingKey, buffer, properties] = events.route.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(routingKey).toStrictEqual(key)
    expect(decode({ content: buffer, properties })).toStrictEqual(payload)
  })

  it('should pass properties through', async () => {
    jest.clearAllMocks()

    const properties = { headers: { 'x-region': 'eu' }, persistent: true }

    await io.route(exchange, key, payload, properties)

    expect(events.route.mock.calls[0][3]).toMatchObject(properties)
  })
})

describe('subscribe', () => {
  const consumer = jest.fn()

  it('should bind the queue under the key and consume it', async () => {
    await io.subscribe(exchange, queue, key, consumer)

    events = await connection.createChannel.mock.results[0].value

    expect(events.bound).toHaveBeenCalledTimes(1)

    const [name, bound, routingKey] = events.bound.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(bound).toStrictEqual(queue)
    expect(routingKey).toStrictEqual(key)
  })

  it('should hand the payload to the consumer', async () => {
    await io.subscribe(exchange, queue, key, consumer)

    events = await connection.createChannel.mock.results[0].value

    const deliver = events.bound.mock.calls[0][3]
    const properties = { contentType: 'application/json' }
    const message = { content: encode(payload, properties.contentType), properties }

    await deliver(message)

    expect(consumer).toHaveBeenCalledWith(payload, properties)
  })
})
