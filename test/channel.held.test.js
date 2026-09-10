'use strict'

// region setup

const { generate } = require('randomstring')
const { timeout } = require('./helpers')

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

  global.COMQ_TESTING_LOCK_INTERVAL = 5

  connection = await amqplib.connect()
  topology = fixtures.preset()
  channel = await create(connection, topology)
  chan = await getCreatedChannel(connection)
})

afterEach(() => {
  delete global.COMQ_TESTING_LOCK_INTERVAL
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

  it('should wait while another connection holds the queue', async () => {
    const locked = jest.fn()

    channel.diagnose('locked', locked)
    lock(connection, { times: 2 })

    await channel.held(exchange, queue, key, consumer)

    expect(locked).toHaveBeenCalledTimes(2)
    expect(locked).toHaveBeenCalledWith(queue)
    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.any(Object))
  })

  it('should stop waiting once sealed', async () => {
    lock(connection)

    const holding = channel.held(exchange, queue, key, consumer)

    await timeout(20)
    await channel.seal()
    await holding

    expect(chan.bindQueue).not.toHaveBeenCalled()
    expect(chan.consume).not.toHaveBeenCalled()
  })

  it('should reject on any other refusal', async () => {
    lock(connection, { code: 403 })

    await expect(channel.held(exchange, queue, key, consumer)).rejects.toBeDefined()
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

  it('should hold the queue on the new connection', async () => {
    const replacement = await amqplib.connect()

    await channel.recover(replacement)
    await timeout(5)

    const repl = await getCreatedChannel(replacement)
    const [probe] = await getProbes(replacement)

    expect(probe.assertQueue).toHaveBeenCalledWith(queue, { exclusive: true })
    expect(repl.bindQueue).toHaveBeenCalledWith(queue, exchange, key)
  })

  it('should restore the rest while the queue is held elsewhere', async () => {
    const replacement = await amqplib.connect()

    lock(replacement, { main: true })

    const recovered = channel.recover(replacement).then(() => true)
    const hung = timeout(200).then(() => false)

    await expect(Promise.race([recovered, hung])).resolves.toStrictEqual(true)

    const repl = await getCreatedChannel(replacement)

    expect(repl.consume).toHaveBeenCalledWith(other, expect.any(Function), expect.any(Object))
    expect(repl.bindQueue).not.toHaveBeenCalledWith(queue, exchange, key)

    await channel.seal()
  })
})

/**
 * Makes the channels a connection creates from now on refuse an exclusive queue.
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
