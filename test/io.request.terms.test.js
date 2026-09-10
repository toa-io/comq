'use strict'

// region setup

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { immediate, timeout } = require('./helpers')

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

const queue = generate()
const payload = { [generate()]: generate() }

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

// endregion

describe('timeout', () => {
  it('should expire the Request when the caller stops waiting', async () => {
    io.request(queue, payload, { timeout: 10000 }).catch(noop)

    await initialized()

    const expiration = Number(requests.send.mock.calls[0][2].expiration)

    expect(expiration).toBeGreaterThan(9000)
    expect(expiration).toBeLessThanOrEqual(10000)
  })

  it('should keep the encoding', async () => {
    const encoding = 'application/octet-stream'

    io.request(queue, randomBytes(8), { encoding, timeout: 10000 }).catch(noop)

    await initialized()

    expect(requests.send.mock.calls[0][2].contentType).toStrictEqual(encoding)
  })

  it('should reject once it has passed', async () => {
    const promise = io.request(queue, payload, { timeout: 20 })

    await expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('should resolve with a reply that arrives in time', async () => {
    const promise = io.request(queue, payload, { timeout: 10000 })
    const content = randomBytes(8)

    await initialized()
    await answer(0, content)

    await expect(promise).resolves.toStrictEqual(content)
  })

  it('should re-send with the time that is left', async () => {
    io.request(queue, payload, { timeout: 10000 }).catch(noop)

    await initialized()
    await timeout(20)

    emit(requests, 'recover')

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(2)

    const first = Number(requests.send.mock.calls[0][2].expiration)
    const second = Number(requests.send.mock.calls[1][2].expiration)

    expect(second).toBeLessThan(first)
  })
})

describe('signal', () => {
  it('should reject with the reason it was aborted for', async () => {
    const controller = new AbortController()
    const reason = new Error(generate())
    const promise = io.request(queue, payload, { signal: controller.signal })

    await initialized()

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })

  it('should leave the Request in its queue', async () => {
    const controller = new AbortController()

    io.request(queue, payload, { signal: controller.signal }).catch(noop)

    await initialized()

    expect(requests.send.mock.calls[0][2].expiration).toBeUndefined()
  })

  it('should send nothing once aborted', async () => {
    const controller = new AbortController()

    // the channels exist before the aborted Request is made
    io.request(queue, payload).catch(noop)

    await initialized()

    controller.abort()

    await expect(io.request(queue, payload, { signal: controller.signal })).rejects.toBeDefined()

    expect(requests.send).toHaveBeenCalledTimes(1)
  })

  it('should not re-send what it abandoned', async () => {
    const controller = new AbortController()
    const promise = io.request(queue, payload, { signal: controller.signal })

    await initialized()

    controller.abort()

    await promise.catch(noop)

    emit(requests, 'recover')

    await immediate()

    expect(requests.send).toHaveBeenCalledTimes(1)
  })

  it('should stop waiting for a publication', async () => {
    io.request(queue, payload).catch(noop)

    await initialized()

    requests.send.mockImplementationOnce(() => new Promise(noop))

    const controller = new AbortController()
    const reason = new Error(generate())
    const promise = io.request(queue, payload, { signal: controller.signal })

    await immediate()

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })

  it('should discard a reply that arrives afterwards', async () => {
    const controller = new AbortController()
    const promise = io.request(queue, payload, { signal: controller.signal })

    await initialized()

    controller.abort()

    await promise.catch(noop)

    await expect(answer(0)).resolves.toBeUndefined()
  })

  it('should end the wait within the timeout', async () => {
    const controller = new AbortController()
    const promise = io.request(queue, payload, { signal: controller.signal, timeout: 20 })

    await expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

async function initialized () {
  // allows initializers to run
  await immediate()

  requests = await findChannel('request')
  replies = await findChannel('reply')
}

/**
 * @param {number} index of the publication answered
 * @param {Buffer} [content]
 */
async function answer (index, content = randomBytes(8)) {
  const { correlationId } = requests.send.mock.calls[index][2]
  const deliver = replies.consume.mock.calls[0][1]

  await deliver({ content, properties: { correlationId } })
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

/**
 * @param {jest.MockedObject<comq.Channel>} channel
 * @param {string} event
 */
function emit (channel, event) {
  for (const [name, listener] of channel.diagnose.mock.calls) {
    if (name === event) listener()
  }
}

function noop () {}
