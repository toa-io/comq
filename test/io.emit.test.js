'use strict'

const stream = require('node:stream')
const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')

const { encode } = require('../source/encode')
const { encodings } = require('./encodings')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

/** @type {jest.MockedObject<comq.Channel>} */
let events

const exchange = generate()
const payload = generate()

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)

  await io.emit(exchange, payload)

  events = await findChannel('event')
})

it('should be', async () => {
  expect(io.emit).toBeDefined()
})

it('should create events channel', async () => {
  expect(connection.createChannel).toHaveBeenCalledWith('event')
  expect(events).toBeDefined()
})

it('should publish to an exchange', async () => {
  expect(events.publish).toHaveBeenCalledTimes(1)

  const args = events.publish.mock.calls[0]

  expect(args[0]).toStrictEqual(exchange)
})

it('should publish stream of events', async () => {
  jest.clearAllMocks()

  function * generate () {
    for (let i = 0; i < 10; i++) yield i
  }

  const input = stream.Readable.from(generate())

  await io.emit(exchange, input)

  expect(events.publish).toHaveBeenCalledTimes(10)
})

it('should encode message as msgpack by default', async () => {
  const encoding = 'application/msgpack'
  const buf = encode(payload, encoding)
  const [, buffer, properties] = events.publish.mock.calls[0]

  expect(buffer).toStrictEqual(buf)
  expect(properties.contentType).toStrictEqual(encoding)
})

it.each(encodings)('should publish message encoded as %s', async (encoding) => {
  await io.emit(exchange, payload, encoding)

  const buf = encode(payload, encoding)
  const [, buffer, properties] = events.publish.mock.calls[1]

  expect(buffer).toStrictEqual(buf)
  expect(properties.contentType).toStrictEqual(encoding)
})

it('should publish Buffer as application/octet-steam by default', async () => {
  const payload = randomBytes(8)

  await io.emit(exchange, payload)
  const [, buffer, properties] = events.publish.mock.calls[1]

  expect(buffer).toStrictEqual(payload)
  expect(properties.contentType).toStrictEqual('application/octet-stream')
})

it('should publish Buffer with specified encoding format', async () => {
  const payload = randomBytes(8)
  const encoding = 'application/json'

  await io.emit(exchange, payload, encoding)

  const [, buffer, properties] = events.publish.mock.calls[1]

  expect(buffer).toStrictEqual(payload)
  expect(properties.contentType).toStrictEqual(encoding)
})

it('should publish a message with specified properties', async () => {
  const payload = randomBytes(8)

  /** @type {comq.amqp.Properties} */
  const properties = { headers: { [generate()]: generate() } }

  await io.emit(exchange, payload, properties)

  const [, , options] = events.publish.mock.calls[1]

  expect(options).toStrictEqual(expect.objectContaining(properties))
})

it('should publish a message with headers', async () => {
  const message = generate()
  const headers = { [generate()]: generate() }
  const properties = { headers }

  await io.emit(exchange, message, properties)

  const [, , options] = events.publish.mock.calls[1]

  expect(options.headers).toStrictEqual(headers)
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
