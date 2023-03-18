'use strict'

const { generate } = require('randomstring')
const { promex, sample, immediate, random } = require('@toa.io/generic')

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

it('should resolve when one of the connections has created a channel', async () => {
  /** @type {toa.generic.Promex[]} */
  const promises = []

  for (const conn of connections) {
    const promise = promex()

    conn.createChannel.mockImplementation(() => promise)

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

  for (const promise of promises) if (promise !== any) promise.resolve(chan)

  await Promise.all(promises)
})

it('should create failfast channels of given type', async () => {
  await create(connections, type)

  for (const conn of connections) {
    expect(conn.createChannel).toHaveBeenCalledWith(type, true)
  }
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

    connections[0].createChannel.mockImplementation(() => promise)

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
})

describe('diagnose', () => {
  const events = /** @type {comq.diagnostics.event[]} */ ['flow', 'drain', 'recover', 'discard']

  it.each(events)('should re-emit %s event',
    async (event) => {
      channel = await create(connections, type)

      const listener = /** @type {Function} */ jest.fn()
      const channels = await getCreatedChannels()
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
})

/**
 * @return {Promise<Array<comq.Channel>>}
 */
async function getCreatedChannels () {
  const promises = connections.map((connection) => connection.createChannel.mock.results[0].value)

  return await Promise.all(promises)
}
