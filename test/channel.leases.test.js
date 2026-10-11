'use strict'

// region setup

const { randomBytes } = require('node:crypto')
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

const queue = generate()
const buffer = randomBytes(8)

// a lease is a third of it
const EXPIRES = 60
const TERM = EXPIRES / 3

const EXPIRING = { durable: true, arguments: { 'x-expires': EXPIRES } }

beforeEach(async () => {
  jest.clearAllMocks()

  connection = await amqplib.connect()
  topology = { ...fixtures.preset(), durable: true, delay: 1, expires: EXPIRES }
  channel = await create(connection, topology)
  chan = await getCreatedChannel(connection)
})

// endregion

describe('a queue that expires', () => {
  it('should be declared on a channel of its own', async () => {
    await channel.send(queue, buffer)

    const [probe] = await getProbes(connection)

    expect(probe.assertQueue).toHaveBeenCalledWith(queue, EXPIRING)
    expect(probe.close).toHaveBeenCalled()
    expect(chan.assertQueue).not.toHaveBeenCalled()
  })

  it('should be declared once by the messages sent at once', async () => {
    await Promise.all([channel.send(queue, buffer), channel.send(queue, buffer)])

    expect(await getProbes(connection)).toHaveLength(1)
    expect(chan.publish).toHaveBeenCalledTimes(2)
  })

  it('should not be declared again while the lease lasts', async () => {
    await channel.send(queue, buffer)
    await channel.send(queue, buffer)

    expect(await getProbes(connection)).toHaveLength(1)
    expect(chan.assertQueue).not.toHaveBeenCalled()
  })

  it('should be declared again before a message once the lease is over', async () => {
    await channel.send(queue, buffer)
    await timeout(TERM + 5)
    await channel.send(queue, buffer)

    expect(chan.assertQueue).toHaveBeenCalledTimes(1)
    expect(chan.assertQueue).toHaveBeenCalledWith(queue, EXPIRING)

    const declared = chan.assertQueue.mock.invocationCallOrder[0]
    const published = chan.publish.mock.invocationCallOrder[1]

    expect(declared).toBeLessThan(published)
  })

  it('should be declared again by whoever asks once the lease is over', async () => {
    await channel.send(queue, buffer)

    expect(channel.lease(queue)).toBeUndefined()

    await timeout(TERM + 5)
    await Promise.all([channel.lease(queue), channel.lease(queue)])

    expect(chan.assertQueue).toHaveBeenCalledTimes(1)
    expect(channel.lease(queue)).toBeUndefined()
  })

  it('should be declared anew once it is released', async () => {
    await channel.send(queue, buffer)

    channel.release(queue)

    await channel.send(queue, buffer)

    expect(await getProbes(connection)).toHaveLength(2)
  })

  it('should be declared anew by a channel that is recovered', async () => {
    await channel.send(queue, buffer)
    await channel.recover(connection)
    await channel.send(queue, buffer)

    const declarations = (await getProbes(connection))
      .filter((probe) => probe.assertQueue.mock.calls.length > 0)

    expect(declarations).toHaveLength(2)
  })

  it('should be declared as one where it is consumed', async () => {
    await channel.consume(queue, jest.fn())

    const [probe] = await getProbes(connection)

    expect(probe.assertQueue).toHaveBeenCalledWith(queue, EXPIRING)
    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.any(Object))
  })

  it('should tell what the queues expire in', async () => {
    expect(channel.expires).toStrictEqual(EXPIRES)
  })
})

describe('a queue that was declared without an expiry', () => {
  const legacy = jest.fn()

  beforeEach(() => {
    channel.diagnose('legacy', legacy)
    refuse(connection, { times: 1 })
  })

  it('should be used as it is found', async () => {
    await channel.send(queue, buffer)

    const [refused, probe] = await getProbes(connection)

    expect(refused.assertQueue).toHaveBeenCalledWith(queue, EXPIRING)
    expect(probe.assertQueue).toHaveBeenCalledWith(queue, { durable: true })
    expect(chan.publish).toHaveBeenCalledTimes(1)
    expect(legacy).toHaveBeenCalledWith(queue)
  })

  it('should not be declared again', async () => {
    await channel.send(queue, buffer)
    await timeout(TERM + 5)
    await channel.send(queue, buffer)

    expect(await getProbes(connection)).toHaveLength(2)
    expect(chan.assertQueue).not.toHaveBeenCalled()
    expect(chan.publish).toHaveBeenCalledTimes(2)
  })
})

it('should fail on a queue that expires in something else', async () => {
  refuse(connection)

  await expect(channel.send(queue, buffer)).rejects.toMatchObject({ code: 406 })

  expect(chan.publish).not.toHaveBeenCalled()
})

it('should fail on a connection that has no channel left to declare a queue on', async () => {
  const exhausted = new Error('No channels left to allocate')

  connection.createChannel.mockImplementation(async () => { throw exhausted })

  await expect(channel.send(queue, buffer)).rejects.toBe(exhausted)
})

it('should refuse a queue that expires before its messages are retried', async () => {
  topology.delay = [1, EXPIRES]

  await expect(create(connection, topology)).rejects.toBeInstanceOf(RangeError)
})

it('should declare a queue that does not expire once', async () => {
  delete topology.expires

  channel = await create(connection, topology)
  chan = await last(connection)

  await channel.send(queue, buffer)
  await timeout(TERM + 5)
  await channel.send(queue, buffer)

  expect(chan.assertQueue).toHaveBeenCalledTimes(1)
  expect(chan.assertQueue).toHaveBeenCalledWith(queue, { durable: true })
  expect(channel.expires).toBeUndefined()
})

// region helpers

/**
 * Makes the broker refuse the queues declared on the channels created from now on.
 *
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @param {{ times?: number }} [options]
 */
function refuse (conn, { times = Infinity } = {}) {
  const create = conn.createChannel.getMockImplementation()
  let refused = 0

  conn.createChannel.mockImplementation(async () => {
    const created = await create()

    if (refused++ < times) {
      created.assertQueue.mockImplementation(async () => {
        created.emit('error', Object.assign(new Error('Refused'), { code: 406 }))

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
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @returns {Promise<jest.MockedObject<comq.amqp.Channel>>}
 */
function last (conn) {
  const method = `create${topology.confirms ? 'Confirm' : ''}Channel`

  return conn[method].mock.results.at(-1).value
}

/**
 * The channels a connection created to declare a queue on.
 *
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @returns {Promise<jest.MockedObject<comq.amqp.Channel>[]>}
 */
async function getProbes (conn) {
  const created = await Promise.all(conn.createChannel.mock.results.map((result) => result.value))

  return topology.confirms ? created : created.slice(1)
}

// endregion
