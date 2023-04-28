'use strict'

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { promex, sample, immediate, random, each } = require('@toa.io/generic')

const mock = require('../connection.mock')

const { create } = require('../../source/shards/channel')

it('should be', async () => {
  expect(create).toBeInstanceOf(Function)
})

/** @type {Array<jest.MockedObject<comq.Connection>>} */
const connections = [mock.connection(), mock.connection()]
const type = /** @type {comq.topology.type} */ generate()

/** @type {comq.Channel} */
let channel

beforeEach(() => {
  jest.clearAllMocks()
})

it('should expose `sharded`', async () => {
  channel = await create(connections, type)

  expect(channel.sharded).toStrictEqual(true)
})

it('should resolve when one of the connections has created a channel', async () => {
  /** @type {toa.generic.Promex[]} */
  const promises = []

  for (const conn of connections) {
    const promise = promex()

    conn.createChannel.mockImplementationOnce(() => promise)

    promises.push(promise)
  }

  let any
  const chan = mock.channel()

  setImmediate(() => {
    any = sample(promises)
    any.resolve(chan)
  })

  await create(connections, type)
  await immediate()

  expect(any).toBeDefined()

  // resolve pending promises
  for (const promise of promises) if (promise !== any) promise.resolve(chan)

  await Promise.all(promises)
})

it('should create failfast channels of given type', async () => {
  await create(connections, type)

  each(connections, (conn, index) => {
    expect(conn.createChannel).toHaveBeenCalledWith(type, index)
  })
})

describe.each(['consume', 'subscribe'])('%s', (method) => {
  const exchange = generate()
  const queue = generate()
  const group = generate()
  const processor = jest.fn()
  const args = method === 'consume' ? [queue, processor] : [exchange, group, processor]

  it(`should ${method} using all channels`, async () => {
    channel = await create(connections, type)

    const channels = await getCreatedChannels()

    expect(channels.length).toStrictEqual(2)

    await channel[method](...args)

    for (const chan of channels) expect(chan[method]).toHaveBeenCalledWith(...args)
  })

  it(`should should ${method} using available and pending channels`, async () => {
    const promise = promex()

    connections[0].createChannel.mockImplementationOnce(() => promise)

    channel = await create(connections, type)

    await channel[method](...args)

    /** @type {jest.MockedObject<comq.Channel>} */
    const chan1 = await connections[1].createChannel.mock.results[0].value

    expect(chan1[method]).toHaveBeenCalled()

    /** @type {jest.MockedObject<comq.Channel>} */
    const chan0 = mock.channel()

    promise.resolve(chan0)

    await immediate()

    expect(chan0[method]).toHaveBeenCalled()
  })

  it(`should ${method} using a channel removed from the pool once it is recovered`, async () => {
    channel = await create(connections, type)

    const channels = await getCreatedChannels()
    const chan = sample(channels)
    const buffer = randomBytes(8)
    const fail = /** @type {jest.MockedFunction} */ jest.fn(async () => { throw new Error() })

    chan.publish.mockImplementationOnce(fail)

    // `chan` has failed and removed from the pool
    while (fail.mock.calls.length === 0) await channel.publish(exchange, buffer)

    await channel[method](...args)

    expect(chan[method]).not.toHaveBeenCalled()

    const calls = chan.diagnose.mock.calls.filter((call) => call[0] === 'recover')
    const listeners = calls.map((call) => call[1])

    // emit `recover` event
    for (const listener of listeners) await listener()

    await immediate()

    expect(chan[method]).toHaveBeenCalled()
  })
})

describe.each(/** @type {string[]} */['send', 'publish', 'fire'])('%s', (method) => {
  const label = generate()
  const buffer = randomBytes(8)
  const options = { contentType: generate() }

  /** @type {jest.MockedObject<comq.Channel>[]} */
  let channels

  beforeEach(async () => {
    channel = await create(connections, type)
    channels = await getCreatedChannels()
  })

  it('should send to single channel', async () => {
    await channel[method](label, buffer, options)

    let used = 0

    for (const chan of channels) {
      if (chan[method].mock.calls.length === 0) continue

      used++

      expect(chan[method]).toHaveBeenCalledWith(label, buffer, options)
    }

    expect(used).toStrictEqual(1)
  })

  it('should route pending messages among remaining shards', async () => {
    const b = random(channels.length)
    const broken = channels[b]
    const options = { contentType: generate() }
    let thrown = false

    broken[method].mockImplementationOnce(async () => {
      thrown = true
      throw new Error()
    })

    let i = 0

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!thrown) await channel[method](label + ++i, buffer, options)

    const last = label + i

    // now channel has thrown an exception
    expect(broken[method]).toHaveBeenCalledWith(last, buffer, options)

    const r = (b + 1) % 2
    const remaining = channels[r]

    expect(remaining[method]).toHaveBeenCalledWith(last, buffer, options)
  })

  it('should wait for recovery', async () => {
    const reject = async () => { throw new Error() }

    /** @type {jest.MockedObject<comq.Channel>} */
    let recovered

    // both shards rejects and will be removed from the pool
    channels[0][method].mockImplementationOnce(reject)
    channels[1][method].mockImplementationOnce(reject)

    setImmediate(() => {
      const r = random(channels.length)

      recovered = channels[r]

      // subscriptions to the 'recover' event
      const calls = recovered.diagnose.mock.calls.filter(
        (call) => call[0] === 'recover')

      expect(calls.length).toBeGreaterThan(0)

      // emit 'recover' event to return shard to the pool
      for (const call of calls) call[1]()
    })

    await channel[method](label, buffer, options)

    expect(recovered).toBeDefined()
    expect(recovered[method]).toHaveBeenCalledTimes(2) // failed and succeeded
  })
})

describe('seal', () => {
  it('should seal channels', async () => {
    channel = await create(connections, type)

    await channel.seal()

    const channels = await getCreatedChannels()

    for (const chan of channels) expect(chan.seal).toHaveBeenCalled()
  })

  it('should seal channels eventually', async () => {
    expect.assertions(connections.length + 1)

    channel = await create(connections, type)

    const channels = await getCreatedChannels()
    const chan = sample(channels)
    const promise = promex()
    let sealed = false

    chan.seal.mockImplementationOnce(() => promise)

    setImmediate(() => {
      expect(sealed).toStrictEqual(false)

      promise.resolve()
    })

    await channel.seal()

    sealed = true

    for (const chan of channels) expect(chan.seal).toHaveBeenCalled()
  })

  it('should seal pending channel', async () => {
    const connection = sample(connections)
    const promise = promex()

    connection.createChannel.mockImplementationOnce(() => promise)

    channel = await create(connections, type)

    /** @type {jest.MockedObject<comq.Channel>} */
    let chan

    setImmediate(() => {
      chan = mock.channel()

      promise.resolve(chan)
    })

    await channel.seal()

    expect(chan).toBeDefined()
    expect(chan.seal).toHaveBeenCalled()
  })
})

describe('diagnose', () => {
  const events = /** @type {comq.diagnostics.event[]} */ ['flow', 'drain', 'recover', 'discard']

  /** @type {jest.MockedObject<comq.Channel>[]} */
  let channels

  beforeEach(async () => {
    channel = await create(connections, type)
    channels = await getCreatedChannels()
  })

  it.each(events)('should re-emit `%s` event',
    async (event) => {
      const listener = /** @type {Function} */ jest.fn()
      const index = random(channels.length)
      const chan = channels[index]

      channel.diagnose(event, listener)

      expect(chan.diagnose).toHaveBeenCalledWith(event, expect.any(Function))

      const call = chan.diagnose.mock.calls.find((call) => call[0] === event)
      const emit = call[1]
      const args = [generate(), generate()]

      emit(...args)

      expect(listener).toHaveBeenCalledWith(...args, index)
    })

  it('should emit `remove` event', async () => {
    const queue = generate()
    const buffer = randomBytes(8)
    const chan = sample(channels)
    const listener = /** @type {jest.MockedFunction} */ jest.fn()

    let thrown = false

    channel.diagnose('remove', listener)

    chan.send.mockImplementationOnce(() => {
      thrown = true
      throw new Error()
    })

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!thrown) await channel.send(queue, buffer)

    expect(listener).toHaveBeenCalledWith(expect.any(Number))
  })
})

it('should not throw on recovery (if the "bench" is empty)', async () => {
  channel = await create(connections, type)

  const channels = await getCreatedChannels()
  const chan = sample(channels)

  expect(chan.diagnose).toHaveBeenCalledWith('recover', expect.any(Function))

  const calls = chan.diagnose.mock.calls.filter((call) => call[0] === 'recover')
  const listeners = calls.map((call) => call[1])

  // emit 'recover'
  const emit = () => { for (const listener of listeners) listener() }

  expect(emit).not.toThrow()
})

it('should remove channel with back pressure from the pool', async () => {
  channel = await create(connections, type)

  const queue = generate()
  const buffer = randomBytes(8)
  const channels = await getCreatedChannels()
  const chan = sample(channels)
  const flowCalls = chan.diagnose.mock.calls.filter((call) => call[0] === 'flow')
  const drainCalls = chan.diagnose.mock.calls.filter((call) => call[0] === 'drain')
  const flowListeners = flowCalls.map((call) => call[1])
  const drainListeners = drainCalls.map((call) => call[1])

  async function send () {
    for (let i = 0; i < 10; i++) await channel.send(queue, buffer)
  }

  await send()

  expect(chan.send).toHaveBeenCalled()

  chan.send.mockClear()

  for (const flow of flowListeners) flow()

  await send()

  expect(chan.send).not.toHaveBeenCalled()

  for (const drain of drainListeners) drain()

  await send()

  expect(chan.send).toHaveBeenCalled()
})

/**
 * @return {Promise<jest.MockedObject<comq.Channel>[]>}
 */
async function getCreatedChannels () {
  const promises = connections.map((connection) => connection.createChannel.mock.results[0].value)

  return await Promise.all(promises)
}
