'use strict'

// region setup

const { randomBytes } = require('node:crypto')
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

const queue = generate()
const produce = jest.fn(async () => generate())

// endregion

describe('channels', () => {
  it('should create request-reply channels', async () => {
    await io.reply(queue, produce)

    expect(connection.createChannel).toHaveBeenCalledWith('request')
    expect(connection.createChannel).toHaveBeenCalledWith('reply')
  })

  it('should create channels once', async () => {
    const label1 = generate()
    const label2 = generate()

    await io.reply(label1, produce)
    await io.reply(label2, produce)

    expect(connection.createChannel.mock.calls.length).toStrictEqual(2)
  })

  it('should concurrently create channels once', async () => {
    const label1 = generate()
    const label2 = generate()

    await Promise.all([io.reply(label1, produce), io.reply(label2, produce)])

    expect(connection.createChannel.mock.calls.length).toStrictEqual(2)
  })
})

describe('queues', () => {
  /** @type {jest.MockedObject<comq.Channel>} */
  let requests

  beforeEach(async () => {
    await io.reply(queue, produce)

    requests = await findChannel('request')
  })

  it('should consume queue', async () => {
    expect(requests.consume).toHaveBeenCalledWith(queue, expect.any(Function))
  })
})

describe('reply', () => {
  /** @type {jest.MockedObject<comq.Channel>} */
  let requests

  /** @type {jest.MockedObject<comq.Channel>} */
  let replies

  beforeEach(async () => {
    await io.reply(queue, produce)

    requests = await findChannel('request')
    replies = await findChannel('reply')
  })

  it('should `fire` reply', async () => {
    const content = randomBytes(10)
    const properties = { replyTo: generate(), contentType: 'text/plain' }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await producer(message)

    const reply = await produce.mock.results[0].value
    const buffer = encode(reply, properties.contentType)

    expect(replies.fire).toHaveBeenCalledWith(properties.replyTo, buffer, expect.anything())
  })

  it('should throw if producer returned undefined', async () => {
    jest.clearAllMocks()

    const produce = () => undefined

    await io.reply(queue, produce)

    const callback = requests.consume.mock.calls[0][1]
    const content = generate()
    const properties = { replyTo: generate(), contentType: 'text/plain' }
    const message = /** @type {comq.amqp.Message} */ { content, properties }

    await expect(callback(message)).rejects.toThrow('must return a value')
  })

  it('should not throw if message is missing replyTo', async () => {
    const content = generate()
    const properties = { contentType: 'text/plain' }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await expect(producer(message)).resolves.not.toThrow()
  })

  it('should not send reply if request has no `replyTo` property', async () => {
    const content = generate()
    const properties = { contentType: 'text/plain' }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await producer(message)

    expect(replies.fire).not.toHaveBeenCalled()
  })
})

describe('encoding', () => {
  /** @type {jest.MockedObject<comq.Channel>} */
  let requests

  /** @type {jest.MockedObject<comq.Channel>} */
  let replies

  beforeEach(async () => {
    await io.reply(queue, produce)

    requests = await findChannel('request')
    replies = await findChannel('reply')
  })

  it.each(encodings)('should decode message content (%s)', async (encoding) => {
    const value = { [generate()]: generate() }
    const content = encode(value, encoding)
    const properties = { contentType: encoding, replyTo: generate() }
    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await producer(message)

    expect(produce).toHaveBeenCalledWith(value)
  })

  it.each(encodings)('should encode reply with same encoding (%s)', async (encoding) => {
    const request = { [generate()]: generate() }
    const content = encode(request, encoding)

    const properties = {
      replyTo: generate(),
      correlationId: generate(),
      contentType: encoding
    }

    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await producer(message)

    const result = await produce.mock.results[0].value

    expect(result).toBeDefined()

    const reply = encode(result, encoding)

    const props = {
      correlationId: properties.correlationId,
      contentType: properties.contentType
    }

    expect(replies.fire).toHaveBeenCalledWith(properties.replyTo, reply, props)
  })

  it('should set octet-stream for Buffer reply', async () => {
    const request = { [generate()]: generate() }
    const content = encode(request, 'application/msgpack')

    const properties = {
      replyTo: generate(),
      correlationId: generate(),
      contentType: 'application/msgpack'
    }

    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]
    const buffer = randomBytes(8)

    produce.mockImplementationOnce(async () => buffer)

    await producer(message)

    expect(replies.fire)
      .toHaveBeenCalledWith(
        expect.any(String),
        buffer,
        expect.objectContaining({ contentType: 'application/octet-stream' })
      )
  })

  it('should throw if request is missing contentType and reply is not a Buffer', async () => {
    const content = randomBytes(8)

    const properties = {
      replyTo: generate(),
      correlationId: generate()
    }

    const message = /** @type {comq.amqp.Message} */ { content, properties }
    const producer = requests.consume.mock.calls[0][1]

    await expect(producer(message)).rejects.toThrow('must be of type `Buffer`')
  })
})

const findChannel = (type) => {
  const index = connection.createChannel.mock.calls.findIndex(([t]) => (t === type))

  if (index === -1) throw new Error(`${type} channel hasn't been created`)

  return connection.createChannel.mock.results[index].value
}
