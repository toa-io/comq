'use strict'

// region setup

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { immediate } = require('@toa.io/generic')
const { encode } = require('../source/encode')

const mock = require('./connection.mock')
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
  expect(io.request).toBeDefined()
})

const queue = generate()
const payload = { [generate()]: generate() }

/** @type {jest.MockedObject<comq.Channel>} */
let requests

/** @type {jest.MockedObject<comq.Channel>} */
let replies

let promise

const REPLY = new RegExp(`^${queue}..[0-9a-f]+$`)

beforeEach(async () => {
  jest.clearAllMocks()

  promise = io.request(queue, payload)

  // allows initializers to run
  await immediate()

  requests = await findChannel('request')
  replies = await findChannel('reply')
})

it('should initialize request-reply channels', async () => {
  expect(connection.createChannel).toHaveBeenCalledWith('request')
  expect(connection.createChannel).toHaveBeenCalledWith('reply')
})

it('should consume replies queue', async () => {
  expect(replies.consume).toHaveBeenCalledWith(expect.stringMatching(REPLY), expect.any(Function))
})

describe('send', () => {
  let call

  beforeEach(() => {
    expect(requests.send).toHaveBeenCalledTimes(1)
    expect(replies.consume).toHaveBeenCalledTimes(1)

    call = requests.send.mock.calls[0]
  })

  it('should sent request message to the queue', async () => {
    expect(call[0]).toStrictEqual(queue)
  })

  it('should set correlationId', async () => {
    const properties = call[2]

    expect(typeof properties.correlationId).toStrictEqual('string')
  })

  it('should set replyTo', async () => {
    const properties = call[2]
    const rx = new RegExp(`^${queue}..[a-z0-9]+`)

    expect(properties.replyTo).toMatch(rx)
  })

  it('should set replyTo using specified formatter', async () => {
    jest.clearAllMocks()

    /** @type {comq.encoding} */
    const prefix = generate()
    const encoding = 'application/json'
    const formatter = (replyTo) => prefix + replyTo

    promise = io.request(queue, payload, encoding, formatter)

    await immediate()

    call = requests.send.mock.calls[0]

    const properties = requests.send.mock.calls[0][2]

    expect(properties.replyTo).toMatch(new RegExp(`${prefix}${queue}..[a-z0-9]+`))
  })

  it('should consume replyTo', async () => {
    const properties = call[2]
    const queue = replies.consume.mock.calls[0][0]

    expect(properties.replyTo).toStrictEqual(queue)
  })

  it('should encode message with msgpack by default', async () => {
    /** @type {comq.encoding} */
    const contentType = 'application/msgpack'
    const buffer = encode(payload, contentType)

    expect(call[1]).toStrictEqual(buffer)
    expect(call[2]).toMatchObject({ contentType })
  })

  it('should throw if encoding is not supported', async () => {
    const encoding = /** @type {comq.encoding} */ 'wtf/' + generate()

    await expect(io.request(queue, payload, encoding)).rejects.toThrow('is not supported')
  })

  it('should send a Buffer', async () => {
    requests.send.mockClear()

    const payload = randomBytes(8)

    setImmediate(reply)

    await io.request(queue, payload)

    const [, buffer, properties] = requests.send.mock.calls[0]

    expect(buffer).toStrictEqual(payload)
    expect(properties.contentType).toStrictEqual('application/octet-stream')
  })

  it('should send a buffer with the specified encoding', async () => {
    requests.send.mockClear()

    const payload = randomBytes(8)
    const encoding = 'wtf/' + generate()

    setImmediate(reply)

    await io.request(queue, payload, /** @type {comq.encoding} */ encoding)

    const [, buffer, properties] = requests.send.mock.calls[0]

    expect(buffer).toStrictEqual(payload)
    expect(properties.contentType).toStrictEqual(encoding)
  })

  it('should resend unanswered Requests', async () => {
    expect(requests.diagnose).toHaveBeenCalledWith('recover', expect.any(Function))

    const calls = requests.diagnose.mock.calls.filter((call) => call[0] === 'recover')
    const listeners = calls.map((call) => call[1])

    for (const listener of listeners) listener()

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(2)
  })
})

describe('reply', () => {
  it.each([undefined, 'application/octet-stream'])('should return raw content if encoding is %s',
    async (contentType) => {
      const content = randomBytes(8)

      await reply(content, contentType)

      const output = await promise

      expect(output).toStrictEqual(content)
    })

  const encodings = ['application/msgpack', 'application/json']

  it.each(encodings)('should decode %s',
    /**
     * @param {comq.encoding}contentType
     */
    async (contentType) => {
      const value = generate()
      const content = encode(value, contentType)

      await reply(content, contentType)

      const output = await promise

      expect(output).toStrictEqual(value)
    })
})

const reply = async (content = randomBytes(8), contentType = undefined) => {
  const correlationId = requests.send.mock.calls[0][2].correlationId
  const properties = { correlationId, contentType }
  const callback = replies.consume.mock.calls[0][1]
  const message = /** @type {comq.amqp.Message} */ { content, properties }

  await callback(message)
}

/**
 * @param {comq.topology.type} type
 * @returns {jest.MockedObject<comq.Channel>}
 */
const findChannel = (type) => {
  const index = connection.createChannel.mock.calls.findIndex(([t]) => (t === type))

  if (index === -1) throw new Error(`${type} channel hasn't been created`)

  return connection.createChannel.mock.results[index].value
}
