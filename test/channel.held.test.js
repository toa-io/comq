'use strict'

// region setup

const { generate } = require('randomstring')
const { timeout, until } = require('./helpers')

const { amqplib } = require('./amqplib.mock')
const fixtures = require('./channel.fixtures')
const { create } = require('../source/channel')

/** @type {jest.MockedObject<comq.amqp.Connection>} */
let connection

/** @type {comq.Topology} */
let topology

/** @type {comq.Channel} */
let channel

/** @type {jest.MockedObject<comq.amqp.Channel>} */
let chan

const exchange = generate()
const queue = generate()
const key = generate()
const consumer = jest.fn()

beforeEach(async () => {
  jest.clearAllMocks()

  global.COMQ_TESTING_CLAIM_BACKOFF = { base: 5, max: 5 }

  connection = await amqplib.connect()
  topology = fixtures.preset()
  channel = await create(connection, topology)
  chan = await getCreatedChannel(connection)
})

afterEach(() => {
  delete global.COMQ_TESTING_CLAIM_BACKOFF
})

// endregion

describe('held', () => {
  it('should assert a direct exchange', async () => {
    await channel.held(exchange, queue, key, consumer)

    expect(chan.assertExchange).toHaveBeenCalledWith(exchange, 'direct', expect.anything())
  })

  it('should declare the queue exclusive on a channel of its own', async () => {
    await channel.held(exchange, queue, key, consumer)

    const [probe] = await getProbes(connection)

    expect(probe.assertQueue).toHaveBeenCalledWith(queue, { exclusive: true })
    expect(probe.close).toHaveBeenCalled()
  })

  it('should bind the queue under the key', async () => {
    await channel.held(exchange, queue, key, consumer)

    expect(chan.bindQueue).toHaveBeenCalledWith(queue, exchange, key)
  })

  it('should consume the queue', async () => {
    await channel.held(exchange, queue, key, consumer)

    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.any(Object))
  })

  it('should claim the queue again while another connection holds it', async () => {
    const taken = jest.fn()

    channel.diagnose('taken', taken)
    lock(connection, { times: 2 })

    await channel.held(exchange, queue, key, consumer)

    expect(taken).toHaveBeenCalledTimes(2)
    expect(taken).toHaveBeenCalledWith(queue)
    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.any(Object))
  })

  it('should stop claiming once sealed', async () => {
    lock(connection)

    const holding = channel.held(exchange, queue, key, consumer)

    await timeout(20)
    await channel.seal()
    await holding

    expect(chan.bindQueue).not.toHaveBeenCalled()
    expect(chan.consume).not.toHaveBeenCalled()
  })

  it('should reject with any other refusal', async () => {
    lock(connection, { code: 403 })

    await expect(channel.held(exchange, queue, key, consumer)).rejects.toMatchObject({ code: 403 })
  })
})

describe('seal', () => {
  beforeEach(async () => {
    await channel.held(exchange, queue, key, consumer)
  })

  it('should withdraw the key', async () => {
    await channel.seal()

    expect(chan.unbindQueue).toHaveBeenCalledWith(queue, exchange, key)
  })

  it('should withdraw the key before it stops consuming', async () => {
    await channel.seal()

    const [unbound] = chan.unbindQueue.mock.invocationCallOrder
    const [cancelled] = chan.cancel.mock.invocationCallOrder

    expect(unbound).toBeLessThan(cancelled)
  })
})

describe('recovery', () => {
  const other = generate()

  beforeEach(async () => {
    await channel.held(exchange, queue, key, consumer)
    await channel.consume(other, consumer)
  })

  afterEach(async () => {
    await channel.seal()
  })

  it('should hold the queue on the new connection', async () => {
    const replacement = await amqplib.connect()

    await channel.recover(replacement)

    const repl = await getCreatedChannel(replacement)

    expect(await until(() => repl.bindQueue.mock.calls.some(([bound]) => bound === queue), 1000)).toStrictEqual(true)
    expect(repl.bindQueue).toHaveBeenCalledWith(queue, exchange, key)
  })

  it('should restore the rest while another connection holds the queue', async () => {
    const replacement = await amqplib.connect()

    lock(replacement, { main: true })

    const recovered = channel.recover(replacement).then(() => true)
    const hung = timeout(200).then(() => false)

    await expect(Promise.race([recovered, hung])).resolves.toStrictEqual(true)

    const repl = await getCreatedChannel(replacement)

    expect(repl.consume).toHaveBeenCalledWith(other, expect.any(Function), expect.any(Object))
    expect(repl.bindQueue).not.toHaveBeenCalledWith(queue, exchange, key)
  })

  it('should hold the queue once it is let go', async () => {
    const replacement = await amqplib.connect()

    lock(replacement, { main: true, times: 2 })

    await channel.recover(replacement)

    const repl = await getCreatedChannel(replacement)

    expect(await until(() => repl.bindQueue.mock.calls.some(([bound]) => bound === queue), 1000)).toStrictEqual(true)
    expect(repl.bindQueue).toHaveBeenCalledWith(queue, exchange, key)
  })
})

/**
 * Makes the channels a connection creates from now on refuse an exclusive queue, the way a
 * broker does: by closing the channel, with the reason emitted as its error.
 *
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @param {{ times?: number, code?: number, main?: boolean }} [options]
 * `main` says the channel to be created first is the channel under test, which is left alone
 */
function lock (conn, { times = Infinity, code = 405, main = false } = {}) {
  const create = conn.createChannel.getMockImplementation()
  let skip = main && !topology.confirms
  let refused = 0

  conn.createChannel.mockImplementation(async () => {
    const created = await create()

    if (skip) {
      skip = false

      return created
    }

    if (refused < times) {
      refused++

      created.assertQueue.mockImplementation(async () => {
        created.emit('error', Object.assign(new Error('Refused'), { code }))

        throw new Error('Channel closed')
      })
    }

    return created
  })
}

/**
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @returns {Promise<jest.MockedObject<comq.amqp.Channel>>}
 */
function getCreatedChannel (conn) {
  const method = `create${topology.confirms ? 'Confirm' : ''}Channel`

  return conn[method].mock.results[0].value
}

/**
 * The channels a connection created to declare an exclusive queue on.
 *
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @returns {Promise<jest.MockedObject<comq.amqp.Channel>[]>}
 */
async function getProbes (conn) {
  const created = await Promise.all(conn.createChannel.mock.results.map((result) => result.value))

  return topology.confirms ? created : created.slice(1)
}
