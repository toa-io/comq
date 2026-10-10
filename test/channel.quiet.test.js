'use strict'

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { Promex } = require('../source/promex')
const { immediate } = require('./helpers')

const { amqplib } = require('./amqplib.mock')
const { create } = require('../source/channel')

/** @type {jest.MockedObject<comq.amqp.Connection>} */
let connection

/** @type {comq.Channel} */
let channel

/** @type {jest.MockedObject<comq.amqp.Channel>} */
let chan

/** @type {jest.MockedObject<comq.amqp.Channel>[]} */
let probes

const queue = generate()
const message = () => ({ content: randomBytes(8), properties: {}, fields: {} })

/**
 * @param {Partial<comq.Topology>} [topology]
 */
async function open (topology = {}) {
  connection = await amqplib.connect()

  channel = await create(connection, {
    prefetch: 1,
    confirms: true,
    durable: true,
    acknowledgments: true,
    persistent: true,
    delay: [1000],
    ...topology
  })

  chan = await connection.createConfirmChannel.mock.results[0].value
}

const deliver = (message) => chan.consume.mock.calls.at(-1)[1](message)

/**
 * A probe is a channel of its own, the one made last.
 *
 * @param {number} messageCount
 */
function depth (messageCount) {
  connection.createChannel.mockImplementation(async () => {
    const probe = await connection.createConfirmChannel.getMockImplementation()()

    probe.checkQueue.mockImplementation(async (name) => ({ queue: name, messageCount }))
    probes.push(probe)

    return probe
  })
}

const REAL = ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'queueMicrotask']

beforeEach(async () => {
  jest.clearAllMocks()

  probes = []

  // the clock alone: what is awaited here goes through timers of its own
  jest.useFakeTimers({ now: 1_000_000, doNotFake: REAL })

  await open()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('quiet', () => {
  it('should have had nothing to do ever, when nothing happened', async () => {
    await expect(channel.quiet()).resolves.toStrictEqual(0)
  })

  it('should have something to do while a delivery is with its consumer', async () => {
    const consuming = new Promex()

    await channel.consume(queue, () => consuming)

    const delivering = deliver(message())

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())

    consuming.resolve()

    await delivering
  })

  it('should tell when the last delivery was done with', async () => {
    await channel.consume(queue, async () => undefined)
    await deliver(message())

    const done = Date.now()

    jest.advanceTimersByTime(5000)

    await expect(channel.quiet()).resolves.toStrictEqual(done)
  })

  it('should count a delivery nothing is acknowledged for', async () => {
    const consuming = new Promex()

    await open({ acknowledgments: false })
    await channel.consume(queue, () => consuming)

    deliver(message())

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())

    consuming.resolve()

    await immediate()

    jest.advanceTimersByTime(5000)

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now() - 5000)
  })

  it('should hand back what a consumer nothing is acknowledged for returns', async () => {
    await open({ acknowledgments: false })

    const consumer = jest.fn(() => undefined)

    await channel.consume(queue, consumer)

    const one = message()

    expect(deliver(one)).toBeUndefined()
    expect(consumer).toHaveBeenCalledWith(one)
    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())
  })

  it('should have something to do while a publication awaits its confirmation', async () => {
    let confirm

    chan.publish.mockImplementation((_0, _1, _2, _3, callback) => { confirm = callback })

    const sending = channel.send(queue, randomBytes(8))

    await immediate()

    jest.advanceTimersByTime(5000)

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())

    confirm(null)

    await sending
  })

  it('should tell when a message was last published', async () => {
    await channel.send(queue, randomBytes(8))

    const published = Date.now()

    jest.advanceTimersByTime(5000)

    await expect(channel.quiet()).resolves.toStrictEqual(published)
  })

  it('should have something to do until a failed message is delivered again', async () => {
    await channel.consume(queue, async () => { throw new Error('oops') })
    await deliver(message())

    const back = Date.now() + 1000

    jest.advanceTimersByTime(999)

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())

    jest.advanceTimersByTime(2)

    await expect(channel.quiet()).resolves.toStrictEqual(back)
  })

  it('should have something to do while a queue it consumes holds messages', async () => {
    await channel.consume(queue, async () => undefined)

    depth(3)

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())

    expect(probes[0].checkQueue).toHaveBeenCalledWith(queue)
  })

  it('should not ask of queues when it consumes none', async () => {
    await channel.quiet()

    expect(connection.createChannel).not.toHaveBeenCalled()
  })

  it('should take a queue that is gone for an empty one', async () => {
    await channel.consume(queue, async () => undefined)

    connection.createChannel.mockImplementation(async () => {
      const probe = await connection.createConfirmChannel.getMockImplementation()()

      probe.checkQueue.mockImplementation(async () => {
        probe.emit('error', Object.assign(new Error('NOT_FOUND'), { code: 404 }))

        throw new Error('Channel closed by server')
      })

      return probe
    })

    await expect(channel.quiet()).resolves.toStrictEqual(0)
  })

  it('should have something to do when it cannot be told', async () => {
    await channel.consume(queue, async () => undefined)

    connection.createChannel.mockImplementation(async () => { throw new Error('Connection closed') })

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())
  })

  it('should ask of what is consumed again once the connection is restored', async () => {
    await channel.consume(queue, async () => undefined)

    const restored = await amqplib.connect()

    await channel.recover(restored)

    connection = restored
    depth(3)

    await expect(channel.quiet()).resolves.toStrictEqual(Date.now())
    expect(probes[0].checkQueue).toHaveBeenCalledWith(queue)
  })
})

describe('settled', () => {
  it('should resolve when there is nothing to wait for', async () => {
    await expect(channel.settled()).resolves.toBeUndefined()
  })

  it('should wait for the deliveries that are with their consumers', async () => {
    const consuming = [new Promex(), new Promex()]

    let n = 0
    let settled = false

    await channel.consume(queue, () => consuming[n++])

    const delivering = [deliver(message()), deliver(message())]

    channel.settled().then(() => { settled = true })

    await immediate()

    consuming[0].resolve()

    await delivering[0]
    await immediate()

    expect(settled).toStrictEqual(false)

    consuming[1].resolve()

    await delivering[1]
    await immediate()

    expect(settled).toStrictEqual(true)
  })

  it('should wait for the publications that await their confirmation', async () => {
    let confirm
    let settled = false

    chan.publish.mockImplementation((_0, _1, _2, _3, callback) => { confirm = callback })

    const sending = channel.send(queue, randomBytes(8))

    await immediate()

    channel.settled().then(() => { settled = true })

    await immediate()

    expect(settled).toStrictEqual(false)

    confirm(null)

    await sending
    await immediate()

    expect(settled).toStrictEqual(true)
  })
})
