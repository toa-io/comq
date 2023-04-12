'use strict'

// region setup

const { generate } = require('randomstring')
const { encode } = require('../source/encode')

const mock = require('./connection.mock')
const { encodings } = require('./encodings')

const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

// endregion

it('should be', async () => {
  expect(io.consume).toBeDefined()
})

const exchange = generate()
const group = generate()
const consumer = jest.fn(() => undefined)

/** @type {jest.MockedObject<comq.Channel>} */
let events

beforeEach(() => {
  jest.clearAllMocks()
})

describe('group consumption', () => {
  beforeEach(async () => {
    await io.consume(exchange, group, consumer)

    events = await findChannel('event')
  })

  it('should create events channel', async () => {
    expect(connection.createChannel).toHaveBeenCalledWith('event')
  })

  it('should subscribe', async () => {
    expect(events).toBeDefined()

    const queue = exchange + '..' + group

    expect(events.subscribe).toHaveBeenCalledWith(exchange, queue, expect.any(Function))
  })

  it.each(encodings)('should pass decoded event (%s)', async (contentType) => {
    const payload = generate()
    const content = encode(payload, contentType)
    const properties = { contentType }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const callback = events.subscribe.mock.calls[0][2]

    await callback(message)

    expect(consumer.mock.calls[0][0]).toStrictEqual(payload)
  })

  it('should pass properties', async () => {
    const payload = generate()
    const contentType = 'text/plain'
    const content = encode(payload, contentType)
    const properties = { contentType }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const callback = events.subscribe.mock.calls[0][2]

    await callback(message)

    expect(consumer).toHaveBeenCalledWith(payload, properties)
  })
})

describe.each(['omitted', 'undefined'])('exclusive consumption (group is %s)', (option) => {
  beforeEach(async () => {
    if (option === 'omitted') await io.consume(exchange, consumer)
    else await io.consume(exchange, undefined, consumer)

    events = await findChannel('event')
  })

  it('should subscribe', async () => {
    expect(events).toBeDefined()
    expect(events.subscribe).toHaveBeenCalledWith(exchange, undefined, expect.any(Function))
  })

  it('should pass messages to the consumer', async () => {
    const emit = events.subscribe.mock.calls[0][2]
    const content = generate()
    const contentType = 'text/plain'
    const properties = { contentType }
    const message = { content, properties }

    await emit(message)

    expect(consumer.mock.calls[0][0]).toStrictEqual(message.content)
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
