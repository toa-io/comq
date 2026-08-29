'use strict'

// region setup

const stream = require('node:stream')
const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { immediate } = require('./helpers')
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

  it('should consume replyTo', async () => {
    const properties = call[2]
    const queue = replies.consume.mock.calls[0][0]

    expect(properties.replyTo).toStrictEqual(queue)
  })

  it('should encode message with json by default', async () => {
    /** @type {comq.Encoding} */
    const contentType = 'application/json'
    const buffer = encode(payload, contentType)

    expect(call[1]).toStrictEqual(buffer)
    expect(call[2]).toMatchObject({ contentType })
  })

  it('should throw if encoding is not supported', async () => {
    const encoding = /** @type {comq.Encoding} */ 'wtf/' + generate()

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

    await io.request(queue, payload, /** @type {comq.Encoding} */ encoding)

    const [, buffer, properties] = requests.send.mock.calls[0]

    expect(buffer).toStrictEqual(payload)
    expect(properties.contentType).toStrictEqual(encoding)
  })

  it('should send stream of requests', async () => {
    requests.send.mockClear()

    function * generate () {
      for (let i = 0; i < 10; i++) yield i
    }

    const encoding = 'application/json'
    const replyFormatter = (queue) => queue

    setTimeout(replyAll, 10) // read the stream to end

    const input = stream.Readable.from(generate())

    /** @type {Readable} */
    const output = await io.request(queue, input, encoding, replyFormatter)

    expect(output).toBeInstanceOf(stream.Readable)

    const replies = []

    for await (const reply of output) replies.push(reply)

    expect(replies.length).toStrictEqual(10)
    expect(requests.send).toHaveBeenCalledTimes(10)
  })

  it('should resend unanswered Requests', async () => {
    expect(requests.diagnose).toHaveBeenCalledWith('recover', expect.any(Function))

    const calls = requests.diagnose.mock.calls.filter((call) => call[0] === 'recover')
    const listeners = calls.map((call) => call[1])

    for (const listener of listeners) listener()

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(2)
  })

  // a reply that could not be routed has been dropped by the broker
  it('should resend unanswered Requests when the reply channel recovers', async () => {
    expect(replies.diagnose).toHaveBeenCalledWith('recover', expect.any(Function))

    const calls = replies.diagnose.mock.calls.filter((call) => call[0] === 'recover')
    const listeners = calls.map((call) => call[1])

    for (const listener of listeners) listener()

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(2)
  })

  it('should resend unanswered Requests on sharded connection', async () => {
    jest.clearAllMocks()

    connection = mock.connection(true)
    io = new IO(connection)

    promise = io.request(queue, payload)

    // allows initializers to run
    await immediate()

    requests = await findChannel('request')

    expect(requests.sharded).toStrictEqual(true)
    expect(requests.diagnose).toHaveBeenCalledWith('remove', expect.any(Function))

    const calls = requests.diagnose.mock.calls.filter((call) => call[0] === 'remove')
    const listeners = calls.map((call) => call[1])

    for (const listener of listeners) listener()

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(2)
  })

  it('should resend unanswered Requests when a shard is lost', async () => {
    jest.clearAllMocks()

    connection = mock.connection(true)
    io = new IO(connection)

    promise = io.request(queue, payload)

    // allows initializers to run
    await immediate()

    requests = await findChannel('request')

    expect(requests.diagnose).toHaveBeenCalledWith('lost', expect.any(Function))

    await lose()

    expect(requests.send).toHaveBeenCalledTimes(2)
  })

  it('should not interrupt a confirmed reply stream when a shard is lost', async () => {
    jest.clearAllMocks()

    connection = mock.connection(true)
    io = new IO(connection)

    promise = io.request(queue, payload)

    await immediate()

    requests = await findChannel('request')
    replies = await findChannel('reply')

    const correlationId = requests.send.mock.calls[0][2].correlationId
    const callback = replies.consume.mock.calls[0][1]

    await callback(message(correlationId, 0, 'ok', 'control'))

    const output = await promise

    expect(output).toBeInstanceOf(stream.Readable)

    await lose()

    // the stream is carried by whichever shard replied, so it keeps flowing
    const chunk = randomBytes(8)

    await callback(message(correlationId, 1, chunk))

    expect(output.read()).toStrictEqual(chunk)

    output.destroy()
  })

  it('should not resend an answered Request when a shard is lost', async () => {
    jest.clearAllMocks()

    connection = mock.connection(true)
    io = new IO(connection)

    promise = io.request(queue, payload)

    await immediate()

    requests = await findChannel('request')
    replies = await findChannel('reply')

    const correlationId = requests.send.mock.calls[0][2].correlationId
    const callback = replies.consume.mock.calls[0][1]

    const answer = /** @type {comq.amqp.Message} */
      { content: randomBytes(8), properties: { correlationId } }

    await callback(answer)
    await promise

    await lose()

    expect(requests.send).toHaveBeenCalledTimes(1)
  })
})

/**
 * Fires the listeners the IO has attached to the shard loss diagnostic.
 *
 * @return {Promise<void>}
 */
async function lose () {
  const calls = requests.diagnose.mock.calls.filter((call) => call[0] === 'lost')

  for (const [, listener] of calls) listener(0)

  await immediate()
  await immediate()
}

/**
 * @param {string} correlationId
 * @param {number} index
 * @param {any} content
 * @param {string} [type]
 * @return {comq.amqp.Message}
 */
function message (correlationId, index, content, type) {
  const raw = Buffer.isBuffer(content)

  return /** @type {comq.amqp.Message} */ {
    content: raw ? content : encode(content, 'application/json'),
    properties: {
      correlationId,
      type,
      replyTo: queue,
      contentType: raw ? 'application/octet-stream' : 'application/json',
      headers: { index }
    }
  }
}

describe('reply', () => {
  it.each([undefined, 'application/octet-stream'])('should return raw content if encoding is %s',
    async (contentType) => {
      const content = randomBytes(8)

      await reply(content, contentType)

      const output = await promise

      expect(output).toStrictEqual(content)
    })

  const encodings = ['application/json']

  it.each(encodings)('should decode %s',
    /**
     * @param {comq.Encoding}contentType
     */
    async (contentType) => {
      const value = generate()
      const content = encode(value, contentType)

      await reply(content, contentType)

      const output = await promise

      expect(output).toStrictEqual(value)
    })

  it('should re-send the Request if a reply stream is never confirmed', async () => {
    global.COMQ_TESTING_MAX_BUFFER_SIZE = 3

    const correlationId = requests.send.mock.calls[0][2].correlationId
    const callback = replies.consume.mock.calls[0][1]

    try {
      // out of order chunks overflow the buffer, so the stream dies before control.ok
      for (let index = 1; index <= 5; index++) {
        const properties = { correlationId, headers: { index } }
        const message = /** @type {comq.amqp.Message} */ { content: randomBytes(8), properties }

        await callback(message)
      }

      await immediate()
      await immediate()

      expect(requests.send).toHaveBeenCalledTimes(2)
    } finally {
      delete global.COMQ_TESTING_MAX_BUFFER_SIZE
    }
  })
})

const reply = async (content = randomBytes(8), contentType = undefined) => {
  const correlationId = requests.send.mock.calls[0][2].correlationId
  const properties = { correlationId, contentType }
  const callback = replies.consume.mock.calls[0][1]
  const message = /** @type {comq.amqp.Message} */ { content, properties }

  await callback(message)
}

async function replyAll () {
  const callback = replies.consume.mock.calls[0][1]

  for (let i = 0; i < requests.send.mock.calls.length; i++) {
    const call = requests.send.mock.calls[i]
    const correlationId = call[2].correlationId
    const properties = { correlationId }
    const message = /** @type {comq.amqp.Message} */ { content: randomBytes(8), properties }

    await callback(message)
  }
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
