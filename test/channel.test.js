'use strict'

// region setup

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { flip, random, timeout, immediate } = require('./helpers')

const backpressure = require('./backpressure')
const { amqplib } = require('./amqplib.mock')
const fixtures = require('./channel.fixtures')
const { create } = require('../source/channel')
const { Retry, Park } = require('../source/verdicts')

it('should be', async () => {
  expect(create).toBeDefined()
})

/** @type {jest.MockedObject<comq.amqp.Connection>} */
let connection

/** @type {comq.Topology} */
let topology

/** @type {comq.Channel} */
let channel

/** @type {jest.MockedObject<comq.amqp.Channel>} */
let chan

beforeEach(async () => {
  jest.clearAllMocks()

  chan = undefined
  channel = undefined
  connection = await amqplib.connect()
  topology = fixtures.preset()
})

it('should return Channel', async () => {
  channel = await create(connection, topology)

  expect(channel).toBeDefined()
})

it('should set prefetch limit', async () => {
  channel = await create(connection, topology)
  chan = await getCreatedChannel()

  expect(chan.prefetch).toHaveBeenCalledWith(topology.prefetch)
})

it.each([true, false])('should create channel (confirms: %s)', async (confirms) => {
  const method = `create${confirms ? 'Confirm' : ''}Channel`

  topology.confirms = confirms
  channel = await create(connection, topology)

  expect(connection[method]).toHaveBeenCalled()
})

// endregion

describe('consume', () => {
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(async () => undefined)
  const queue = generate()

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)
  })

  it('should assert queue', async () => {
    await channel.consume(queue, consumer)

    const options = topology.durable
      ? { durable: true }
      : { exclusive: true }

    expect(chan.assertQueue).toHaveBeenCalledWith(queue, options)
  })

  it('should start consuming (ack: %s)', async () => {
    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())

    const content = randomBytes(8)
    const message = /** @type {comq.amqp.Message} */ { content }
    const callback = chan.consume.mock.calls[0][1]

    await callback(message)

    expect(consumer).toHaveBeenCalledWith(message)
  })
})

describe('acknowledgments', () => {
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(async () => undefined)
  const queue = generate()

  it.each([
    ['', true],
    ['not ', false]
  ])('should %sack incoming messages', async (_, ack) => {
    topology.acknowledgments = ack
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    const callback = chan.consume.mock.calls[0][1]
    const content = randomBytes(8)
    const message = /** @type {comq.amqp.Message} */ { content }

    await callback(message)

    if (ack) expect(chan.ack).toHaveBeenCalledWith(message)
    else expect(chan.ack).not.toHaveBeenCalled()
  })

  it.each([
    ['manual', true],
    ['automatic', false]
  ])('should create consumer with %s acknowledgments', async (_, ack) => {
    topology.acknowledgments = ack
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    const options = chan.consume.mock.calls[0][2]

    if (ack) expect(options).not.toMatchObject({ noAck: true })
    else expect(options).toMatchObject({ noAck: true })
  })

  it('should ignore Channel ended exception', async () => {
    topology.acknowledgments = true

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    const consumer = /** @type {Function} */ jest.fn(async () => generate())

    await channel.consume(queue, consumer)

    const callback = chan.consume.mock.calls[0][1]
    const content = randomBytes(8)
    const properties = {}
    const fields = {}
    const message = /** @type {comq.amqp.Message} */ { content, properties, fields }

    chan.ack.mockImplementation(() => { throw new Error('Channel closed') })
    chan.nack.mockImplementation(() => { throw new Error('Channel closed') })

    await expect(callback(message)).resolves.not.toThrow()
  })
})

describe('send', () => {
  const queue = generate()
  const buffer = randomBytes(10)
  const options = { contentType: 'application/octet-stream' }

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.send(queue, buffer, options)
  })

  it('should assert queue', async () => {
    const options = topology.durable ? { durable: true } : { exclusive: true }

    expect(chan.assertQueue).toHaveBeenCalledWith(queue, expect.objectContaining(options))
  })

  it('should assert queue once', async () => {
    await channel.send(queue, buffer, options)

    expect(chan.assertQueue).toHaveBeenCalledTimes(1)
  })

  it('should assert queue once concurrently', async () => {
    jest.clearAllMocks()

    const queue = generate()
    const send = () => channel.send(queue, buffer, options)

    await Promise.all([send(), send()])

    expect(chan.assertQueue).toHaveBeenCalledTimes(1)
  })

  it('should publish a message', async () => {
    const call = chan.publish.mock.calls[0]

    expect(call[0]).toStrictEqual('') // default exchange
    expect(call[1]).toStrictEqual(queue)
    expect(call[2]).toStrictEqual(buffer)
    expect(call[3]).toMatchObject(options)
  })

  it('should add persistent option', async () => {
    const options = chan.publish.mock.calls[0][3]

    expect(options).toMatchObject({ persistent: topology.persistent })
  })

  it('should not overwrite persistent option', async () => {
    jest.clearAllMocks()

    const persistent = flip()

    topology.persistent = persistent
    options.persistent = !persistent

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.send(queue, buffer, options)

    const actual = chan.publish.mock.calls[0][3]

    expect(actual.persistent).toStrictEqual(!persistent)
  })

  it.each([
    ['', true],
    [' not', false]
  ])('should%s await confirmation', async (_, confirms) => {
    jest.clearAllMocks()

    topology.confirms = confirms

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.send(queue, buffer, options)

    const callback = chan.publish.mock.calls[0][4]

    if (confirms) expect(callback).toBeInstanceOf(Function)
    else expect(callback).toBeUndefined()
  })

  it.each([
    ['persistent', true],
    ['transient', false]
  ])('should send %s message', async (_, persistent) => {
    jest.clearAllMocks()

    topology.persistent = persistent

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.send(queue, buffer, options)
  })
})

describe('fire', () => {
  const queue = generate()
  const buffer = randomBytes(10)
  const options = { contentType: 'application/octet-stream' }

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  it('should be', async () => {
    expect(channel.fire).toBeDefined()
  })

  it('should publish a message', async () => {
    await channel.fire(queue, buffer, options)

    const call = chan.publish.mock.calls[0]

    expect(call[0]).toStrictEqual('') // default exchange
    expect(call[1]).toStrictEqual(queue)
    expect(call[2]).toStrictEqual(buffer)
    expect(call[3]).toMatchObject(options)
  })

  it('should ignore exceptions', async () => {
    chan.publish.mockImplementation(() => { throw new Error() })

    await expect(channel.fire(queue, buffer, options)).resolves.not.toThrow()
  })

  it('should wait for unpause', async () => {
    jest.clearAllMocks()

    topology.confirms = false
    channel = await create(connection, topology)

    const exchange = generate()
    const queue = generate()
    const buffer = randomBytes(8)
    const options = { contentType: 'application/octet-stream' }

    // create channel
    await channel.publish(exchange, buffer, options)

    const chan = await getCreatedChannel()

    chan.publish.mockImplementation(() => false)

    await channel.publish(exchange, buffer, options) // now paused

    expect(chan.publish).toHaveBeenCalledTimes(2)

    setImmediate(async () => {
      expect(chan.publish).toHaveBeenCalledTimes(2)

      chan.emit('drain')
    })

    await channel.fire(queue, buffer, options)

    expect(chan.publish).toHaveBeenCalledTimes(3)
  })
})

describe.each(['group', 'exclusive'])('%s subscribe', (option) => {
  let queue = option === 'group' ? generate() : undefined

  const exchange = generate()
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(() => undefined)

  beforeEach(async () => {
    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.subscribe(exchange, queue, consumer)
  })

  it('should assert fanout exchange', async () => {
    // the retry exchange is asserted alongside it when the channel acknowledges
    const calls = chan.assertExchange.mock.calls.filter(([name]) => name === exchange)

    expect(calls).toHaveLength(1)

    const [name, type, options] = calls[0]

    expect(name).toStrictEqual(exchange)
    expect(type).toStrictEqual('fanout')

    if (topology.durable) expect(options).not.toMatchObject({ durable: false })
    else expect(options).toMatchObject({ durable: false })
  })

  if (option === 'group') {
    it('should assert queue', async () => {
      const options = topology.durable ? { durable: true } : { exclusive: true }

      expect(chan.assertQueue).toHaveBeenCalledWith(queue, expect.objectContaining(options))
    })
  } else {
    it.each([true, false])('should assert exclusive queue (topology.durable: %s)', async (durable) => {
      jest.clearAllMocks()

      topology.durable = durable

      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.subscribe(exchange, undefined, consumer)

      expect(chan.assertQueue).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ exclusive: true })
      )
    })
  }

  it('should bind queue to exchange', async () => {
    const { queue } = await chan.assertQueue.mock.results[0].value

    // comq binds its own retry queue too, when the channel acknowledges
    const bindings = chan.bindQueue.mock.calls.filter(([, name]) => !name.startsWith('comq.'))

    expect(bindings).toHaveLength(1)
    expect(chan.bindQueue).toHaveBeenCalledWith(queue, exchange, '')
  })

  it.each([
    ['with acknowledgments', true],
    ['without acknowledgments', false]
  ])('should start consuming %s', async (_, ack) => {
    topology.acknowledgments = ack

    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.subscribe(exchange, queue, consumer)

    const options = ack ? {} : { noAck: true }

    queue = (await chan.assertQueue.mock.results[0].value).queue

    expect(chan.consume).toHaveBeenCalledTimes(1)
    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.objectContaining(options))

    const consume = chan.consume.mock.calls[0][1]
    const message = generate()

    await consume(message)

    expect(consumer).toHaveBeenCalledWith(message)

    if (ack) expect(chan.ack).toHaveBeenCalledWith(message)
    else expect(chan.ack).not.toHaveBeenCalledWith(message)
  })
})

describe('publish', () => {
  const exchange = generate()
  const buffer = randomBytes(8)

  it('should be', async () => {
    expect(channel.publish).toBeDefined()
  })

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.publish(exchange, buffer)
  })

  it('should assert exchange', async () => {
    expect(chan.assertExchange).toHaveBeenCalledTimes(1)

    const [name, type, options] = chan.assertExchange.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(type).toStrictEqual('fanout')

    if (topology.durable) expect(options).not.toMatchObject({ durable: false })
    else expect(options).toMatchObject({ durable: false })
  })

  it('should publish message', async () => {
    expect(chan.publish).toHaveBeenCalledTimes(1)

    const call = chan.publish.mock.calls[0]

    expect(call[0]).toStrictEqual(exchange)
    expect(call[1]).toStrictEqual('')
    expect(call[2]).toStrictEqual(buffer)

    if (topology.persistent) expect(call[3]).toMatchObject({ persistent: true })
    else expect(call[3]).not.toMatchObject({ persistent: true })
  })
})

describe('seal', () => {
  const queue = generate()
  const consumer = jest.fn()

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  it('should be', async () => {
    expect(channel.seal).toBeDefined()
  })

  it('should cancel consumption', async () => {
    const tags = []

    for (let i = 0; i < random(5) + 3; i++) {
      await channel.consume(queue, consumer)

      const { consumerTag: tag } = await chan.consume.mock.results[i].value

      expect(tag).toBeDefined()
      expect(tags.indexOf(tag)).toStrictEqual(-1)

      tags.push(tag)
    }

    await channel.seal()

    for (const tag of tags) expect(chan.cancel).toHaveBeenCalledWith(tag)
  })

  it('should ignore exceptions', async () => {
    await channel.consume(queue, consumer)

    chan.cancel.mockImplementationOnce(async () => { throw new Error() })

    await expect(channel.seal()).resolves.not.toThrow()
  })
})

describe('close', () => {
  const queue = generate()
  const consumer = jest.fn()

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  it('should give the channel back', async () => {
    await channel.close()

    expect(chan.close).toHaveBeenCalled()
    expect(channel.closed).toStrictEqual(true)
  })

  it('should stop consuming before giving it back', async () => {
    await channel.consume(queue, consumer)

    const { consumerTag: tag } = await chan.consume.mock.results[0].value

    await channel.close()

    expect(chan.cancel).toHaveBeenCalledWith(tag)
    expect(chan.cancel.mock.invocationCallOrder[0])
      .toBeLessThan(chan.close.mock.invocationCallOrder[0])
  })

  it('should give it back once', async () => {
    await channel.close()
    await channel.close()

    expect(chan.close).toHaveBeenCalledTimes(1)
  })

  // one that went down with its connection is the outcome this asks for
  it('should ignore one that is already gone', async () => {
    chan.close.mockImplementationOnce(async () => { throw new Error() })

    await expect(channel.close()).resolves.not.toThrow()
  })
})

describe('back pressure', () => {
  const exchange = generate()
  const queue = generate()
  const buffer = randomBytes(8)

  it('should apply back pressure', async () => {
    expect.assertions(3)

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    chan.publish.mockImplementationOnce(backpressure.publish)

    await channel.publish(exchange, buffer)

    expect(chan.publish).toHaveBeenCalled()

    setImmediate(() => {
      expect(chan.publish).toHaveBeenCalledTimes(1)

      chan.emit('drain')
    })

    await channel.send(queue, buffer)

    expect(chan.publish).toHaveBeenCalledTimes(2)
  })
})

describe('recovery', () => {
  const exchange = generate()
  const queue = generate()
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(() => undefined)

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  const permanent = [
    ['RESOURCE-LOCKED', { code: 405 }]
  ]

  it.each(permanent)('should not recover on %s', async (_, exception) => {
    chan.assertQueue.mockImplementation(async () => { throw exception })

    await expect(channel.consume(queue, consumer)).rejects.toStrictEqual(exception)
  })

  it('should not deadlock when recall hits a transient error during recover', async () => {
    await channel.consume(queue, consumer)

    const replacement = await amqplib.connect()
    const method = `create${topology.confirms ? 'Confirm' : ''}Channel`

    replacement[method].mockImplementationOnce(async () => {
      const transient = await amqplib.connect()
      const bad = await transient[method]()

      bad.consume.mockImplementation(async () => { throw new Error('Channel closed') })

      return bad
    })

    const deadlock = timeout(200).then(() => {
      throw new Error('recover hung (deadlock)')
    })

    await expect(Promise.race([channel.recover(replacement), deadlock]))
      .rejects.toThrow('Channel closed')
  })

  describe.each(/** @type {[string, boolean][]} */ [
    ['', false],
    [' not', true]
  ])('should%s restore incoming (sealed: %s)', (not, sealed) => {
    beforeEach(async () => {
      if (sealed) await channel.seal()
    })

    it('should re-assert queue', async () => {
      chan.assertQueue.mockImplementation(async () => { throw new Error('Channel closed') })

      /** @type {comq.amqp.Connection} */
      let replacement

      setImmediate(async () => {
        chan.assertQueue.mockImplementation(async () => {})

        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.consume(queue, consumer)

      const repl = await getCreatedChannel(replacement)

      expect(repl.assertQueue).toHaveBeenCalled()
    })

    it('should re-assert exchange', async () => {
      chan.assertExchange.mockImplementation(async () => { throw new Error('Channel ended, no reply will be forthcoming') })

      /** @type {comq.amqp.Connection} */
      let replacement

      setImmediate(async () => {
        chan.assertExchange.mockImplementation(async () => {})

        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.subscribe(exchange, queue, consumer)

      const repl = await getCreatedChannel(replacement)

      expect(repl.assertExchange).toHaveBeenCalled()
    })

    it('should re-bind queue', async () => {
      chan.bindQueue.mockImplementation(async () => { throw new Error('Channel ended, no reply will be forthcoming') })

      /** @type {comq.amqp.Connection} */
      let replacement

      setImmediate(async () => {
        chan.bindQueue.mockImplementation(async () => {})

        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.subscribe(exchange, queue, consumer)

      expect(replacement).toBeDefined()

      const repl = await getCreatedChannel(replacement)

      expect(repl.bindQueue).toHaveBeenCalled()
    })

    it(`should${not} re-consume`, async () => {
      await channel.consume(queue, consumer)

      const replacement = await amqplib.connect()

      await channel.recover(replacement)

      const chan = await getCreatedChannel(replacement)

      if (sealed) expect(chan.consume).not.toHaveBeenCalled()
      else expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())
    })

    it(`should${not} re-consume`, async () => {
      chan.consume.mockImplementation(async () => { throw new Error('Channel ended, no reply will be forthcoming') })

      /** @type {comq.amqp.Connection} */
      let replacement

      setTimeout(async () => {
        // noinspection JSCheckFunctionSignatures
        chan.consume.mockImplementation(async () => ({ consumerTag: generate() }))
        replacement = await amqplib.connect()

        await channel.recover(replacement)
      }, 1)

      await channel.consume(queue, consumer)

      const repl = await getCreatedChannel(replacement)

      if (sealed) expect(repl.consume).not.toHaveBeenCalled()
      else expect(repl.consume).toHaveBeenCalled()
    })

    it(`should${not} re-subscribe`, async () => {
      await channel.subscribe(exchange, queue, consumer)

      const replacement = await amqplib.connect()

      await channel.recover(replacement)

      const repl = await getCreatedChannel(replacement)

      if (sealed) expect(repl.consume).not.toHaveBeenCalled()
      else expect(repl.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())
    })

    it('should re-send', async () => {
      const queue = generate()
      const buffer = Buffer.from(generate())

      /** @type {comq.amqp.Connection} */
      let replacement

      chan.publish.mockImplementation(() => { throw new Error('Channel closed') })

      setImmediate(async () => {
        expect(chan.publish).toHaveBeenCalled()

        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.send(queue, buffer)

      const repl = await getCreatedChannel(replacement)

      expect(repl.publish).toHaveBeenCalled()
    })

    it('should re-publish unconfirmed messages', async () => {
      jest.clearAllMocks()

      const exchange = generate()
      const buffer = randomBytes(8)
      const options = { contentType: 'application/octet-stream' }

      topology.confirms = true
      channel = await create(connection, topology)

      // create channel
      await channel.consume(generate(), () => undefined)

      const chan = await getCreatedChannel()

      chan.publish.mockImplementation(() => true) // back pressure

      /** @type {jest.MockedObject<comq.amqp.Connection>} */
      let replacement

      setImmediate(async () => {
        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.publish(exchange, buffer, options)

      expect(replacement).toBeDefined()

      const repl = await getCreatedChannel(replacement)

      await timeout(5)

      expect(repl.publish).toHaveBeenCalledWith(
        exchange, '', buffer, expect.objectContaining(options), expect.any(Function)
      )
    })

    it('should unpause', async () => {
      jest.clearAllMocks()

      topology.confirms = false
      channel = await create(connection, topology)

      const exchange = generate()
      const buffer = randomBytes(8)
      const options = { contentType: 'application/octet-stream' }

      // create channel
      await channel.publish(exchange, buffer, options)

      const chan = await getCreatedChannel()

      chan.publish.mockImplementation(() => false)

      await channel.publish(exchange, buffer, options) // now paused

      expect(chan.publish).toHaveBeenCalledTimes(2)

      /** @type {jest.MockedObject<comq.amqp.Connection>} */
      let replacement

      setImmediate(async () => {
        replacement = await amqplib.connect()

        await channel.recover(replacement)
      })

      await channel.publish(exchange, buffer, options)

      expect(replacement).toBeDefined()

      const repl = await getCreatedChannel(replacement)

      expect(repl.publish).toHaveBeenCalled()
    })

    it('should emit recover event', async () => {
      const listener = /** @type {Function} */ jest.fn()

      channel = await create(connection, topology)
      channel.diagnose('recover', listener)

      await channel.recover(connection)

      expect(listener).toHaveBeenCalled()
    })
  })
})

describe('diagnostics', () => {
  const exchange = generate()
  const buffer = randomBytes(8)

  it('should be', async () => {
    channel = await create(connection, topology)

    expect(channel.diagnose).toBeDefined()
  })

  it('should emit back pressure events', async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    chan.publish.mockImplementationOnce(backpressure.publish)

    let flowed = false
    let drained = false
    let paused = false
    let resumed = false

    channel.diagnose('flow', () => (flowed = true))
    channel.diagnose('drain', () => (drained = true))
    channel.diagnose('pause', () => (paused = true))
    channel.diagnose('resume', () => (resumed = true))

    await channel.publish(exchange, buffer)

    expect(flowed).toStrictEqual(true)
    expect(paused).toStrictEqual(true)

    chan.emit('drain')

    expect(drained).toStrictEqual(true)
    expect(resumed).toStrictEqual(true)
  })

  it('should emit `discard` event', async () => {
    jest.clearAllMocks()

    topology.acknowledgments = true
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    const listener = /** @type {Function} */ jest.fn()

    channel.diagnose('discard', listener)

    const queue = generate()
    const exception = new Error(generate())
    const consumer = async () => { throw exception }

    await channel.consume(queue, consumer)

    const callback = /** @type {Function} */ chan.consume.mock.calls[0][1]
    const content = randomBytes(8)
    const properties = { headers: { 'x-comq-attempt': 5 } }
    const message = /** @type {comq.amqp.Message} */ { content, properties }

    await callback(message)

    expect(listener).toHaveBeenCalledWith(message, exception)
  })
})

describe('transient', () => {
  const exchange = generate()
  const queue = generate()
  const label = generate()
  const buffer = randomBytes(8)
  const index = random()

  beforeEach(async () => {
    channel = await create(connection, topology, index)
    chan = await getCreatedChannel()
  })

  it.each(/** @type {string[]} */ ['publish', 'send'])('should throw transient exceptions on %s',
    async (method) => {
      chan.publish.mockImplementation(() => { throw new Error('Channel closed') })

      await expect(channel[method](label, buffer)).rejects.toThrow()
    })

  it('should not throw when back pressure is applied', async () => {
    chan.publish.mockImplementationOnce(backpressure.publish)

    await expect(channel.publish(exchange, buffer)).resolves.not.toThrow()
  })

  it('should throw if backpressure was applied before', async () => {
    chan.publish.mockImplementationOnce(backpressure.publish)

    await expect(channel.publish(exchange, buffer)).resolves.not.toThrow()
    await expect(channel.publish(exchange, buffer)).rejects.toBeDefined()
  })

  it('should not ignore exceptions on `fire()`', async () => {
    chan.publish.mockImplementation(() => { throw new Error('Channel closed') })

    await expect(channel.fire(queue, buffer)).rejects.toThrow()
  })

  it('should expose index', async () => {
    expect(channel.index).toStrictEqual(index)
  })
})

/**
 * @param {comq.amqp.Connection} [conn]
 * @return {jest.MockedObject<comq.amqp.Channel>}
 */
const getCreatedChannel = (conn) => {
  const method = `create${topology.confirms ? 'Confirm' : ''}Channel`

  return (conn ?? connection)[method].mock.results[0].value
}

describe('consumer tags', () => {
  const queue = generate()
  const consumer = jest.fn()

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  // the consumers of a lost channel went down with it, and their tags would pile
  // up with every reconnection to be cancelled on a channel that never had them
  it('should cancel the consumers of the current channel only', async () => {
    await channel.consume(queue, consumer)

    const replacement = await amqplib.connect()

    await channel.recover(replacement)

    const repl = await getCreatedChannel(replacement)

    expect(repl.consume).toHaveBeenCalledTimes(1)

    const { consumerTag } = await repl.consume.mock.results[0].value

    await channel.seal()

    expect(repl.cancel).toHaveBeenCalledTimes(1)
    expect(repl.cancel).toHaveBeenCalledWith(consumerTag)
  })

  it('should let go of the recorded subscriptions once sealed', async () => {
    await channel.consume(queue, consumer)
    await channel.seal()

    const replacement = await amqplib.connect()

    await channel.recover(replacement)

    const repl = await getCreatedChannel(replacement)

    expect(repl.consume).not.toHaveBeenCalled()
  })
})

describe('release', () => {
  it('should be called once the channel is closed', async () => {
    const release = jest.fn()

    channel = await create(connection, topology, undefined, release)

    expect(release).not.toHaveBeenCalled()

    await channel.close()

    expect(release).toHaveBeenCalledWith(channel)
  })
})

describe('failed messages', () => {
  const DELAY = 1000
  const RETRY = 'comq.retry.' + DELAY

  let queue
  let exception
  let consumer

  /** @returns {comq.amqp.Message} */
  const delivery = (properties = {}, fields = {}) => ({
    content: randomBytes(8),
    properties,
    fields: { exchange: generate(), routingKey: generate(), ...fields }
  })

  /** The consumer amqplib was given, which is comq's wrapper rather than the callback. */
  const deliver = async (message) => {
    const callback = /** @type {Function} */ chan.consume.mock.calls[0][1]

    return await callback(message)
  }

  const publications = () => chan.publish.mock.calls

  beforeEach(async () => {
    jest.clearAllMocks()

    topology.acknowledgments = true
    topology.durable = true
    topology.confirms = true
    topology.persistent = false
    topology.delay = [DELAY, DELAY, DELAY, DELAY] // four rungs, hence five attempts

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    queue = generate()
    exception = new Error(generate())
    consumer = jest.fn(async () => { throw exception })
  })

  describe('topology', () => {
    it('should assert the retry queue and its exchange', async () => {
      await channel.consume(queue, consumer)

      expect(chan.assertExchange).toHaveBeenCalledWith(RETRY, 'fanout', expect.objectContaining({ durable: true }))

      expect(chan.assertQueue).toHaveBeenCalledWith(RETRY, expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': DELAY,
          'x-dead-letter-exchange': ''
        }
      }))

      expect(chan.bindQueue).toHaveBeenCalledWith(RETRY, RETRY, '')
    })

    it('should not set a dead letter routing key', async () => {
      // the message keeps its own, which names the queue it came from;
      // a fixed one would make the queue serve a single source
      await channel.consume(queue, consumer)

      const [, options] = chan.assertQueue.mock.calls.find(([name]) => name === RETRY)

      expect(options.arguments['x-dead-letter-routing-key']).toBeUndefined()
    })

    it('should assert the parked queue', async () => {
      await channel.consume(queue, consumer)

      expect(chan.assertQueue).toHaveBeenCalledWith('comq.parked.' + queue,
        expect.objectContaining({ durable: true }))
    })

    it('should assert the source queue first', async () => {
      await channel.consume(queue, consumer)

      expect(chan.assertQueue.mock.calls[0][0]).toStrictEqual(queue)
    })

    it('should assert the retry topology once per channel', async () => {
      await channel.consume(generate(), consumer)
      await channel.consume(generate(), consumer)
      await channel.consume(generate(), consumer)

      const exchanges = chan.assertExchange.mock.calls.filter(([name]) => name === RETRY)
      const queues = chan.assertQueue.mock.calls.filter(([name]) => name === RETRY)

      expect(exchanges).toHaveLength(1)
      expect(queues).toHaveLength(1)
    })

    it('should assert a parked queue per consumed queue', async () => {
      const one = generate()
      const another = generate()

      await channel.consume(one, consumer)
      await channel.consume(another, consumer)

      expect(chan.assertQueue).toHaveBeenCalledWith('comq.parked.' + one, expect.anything())
      expect(chan.assertQueue).toHaveBeenCalledWith('comq.parked.' + another, expect.anything())
    })

    it('should not assert either without acknowledgments', async () => {
      jest.clearAllMocks()

      topology.acknowledgments = false
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      const internal = chan.assertQueue.mock.calls.filter(([name]) => name.startsWith('comq.'))

      expect(internal).toHaveLength(0)
      expect(chan.assertExchange).not.toHaveBeenCalled()
    })

    it('should declare the parked queue exclusive for an exclusive queue', async () => {
      jest.clearAllMocks()

      topology.durable = false
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      const [, options] = chan.assertQueue.mock.calls
        .find(([name]) => name === 'comq.parked.' + queue)

      expect(options).toMatchObject({ exclusive: true })
    })

    it('should re-assert after recovery', async () => {
      await channel.consume(queue, consumer)

      const replacement = await amqplib.connect()

      await channel.recover(replacement)

      const repl = await getCreatedChannel(replacement)

      expect(repl.assertExchange).toHaveBeenCalledWith(RETRY, 'fanout', expect.anything())
      expect(repl.assertQueue).toHaveBeenCalledWith('comq.parked.' + queue, expect.anything())
    })
  })

  describe('retry', () => {
    it('should publish to the retry exchange keyed by the source queue', async () => {
      await channel.consume(queue, consumer)

      const message = delivery()

      await deliver(message)

      const [exchange, key] = publications()[0]

      expect(exchange).toStrictEqual(RETRY)
      expect(key).toStrictEqual(queue)
    })

    it('should not republish to the exchange the message came from', async () => {
      await channel.consume(queue, consumer)

      const message = delivery()

      await deliver(message)

      const [exchange] = publications()[0]

      // a fanout source exchange would otherwise redeliver the retry to every subscriber
      expect(exchange).not.toStrictEqual(message.fields.exchange)
    })

    it('should publish before acknowledging', async () => {
      await channel.consume(queue, consumer)

      await deliver(delivery())

      expect(chan.publish.mock.invocationCallOrder[0])
        .toBeLessThan(chan.ack.mock.invocationCallOrder[0])
    })

    it('should wait for the confirmation before acknowledging', async () => {
      await channel.consume(queue, consumer)

      let confirm

      chan.publish.mockImplementationOnce((_0, _1, _2, _3, callback) => { confirm = callback })

      const pending = deliver(delivery())

      await immediate()

      expect(chan.ack).not.toHaveBeenCalled()

      confirm(null)
      await pending

      expect(chan.ack).toHaveBeenCalled()
    })

    it('should increment the attempt', async () => {
      await channel.consume(queue, consumer)

      await deliver(delivery({ headers: { 'x-comq-attempt': 2 } }))

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-attempt']).toStrictEqual(3)
    })

    it('should tolerate a message without headers', async () => {
      // a message published by something that is not comq carries no field table,
      // and the first delivery of any message carries no attempt either
      await channel.consume(queue, consumer)

      await expect(deliver(delivery({}))).resolves.not.toThrow()

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-attempt']).toStrictEqual(2)
    })

    it('should record the origin on the first failure', async () => {
      await channel.consume(queue, consumer)

      const message = delivery()

      await deliver(message)

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-exchange']).toStrictEqual(message.fields.exchange)
      expect(options.headers['x-comq-key']).toStrictEqual(message.fields.routingKey)
    })

    it('should keep the recorded origin on later failures', async () => {
      // a returned retry arrives through the default exchange, so its own fields
      // no longer say where it was published
      await channel.consume(queue, consumer)

      const origin = generate()
      const message = delivery(
        { headers: { 'x-comq-attempt': 1, 'x-comq-exchange': origin, 'x-comq-key': generate() } },
        { exchange: '' })

      await deliver(message)

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-exchange']).toStrictEqual(origin)
    })

    it('should publish persistent from a transient topology', async () => {
      await channel.consume(queue, consumer)

      await deliver(delivery())

      const [, , , options] = publications()[0]

      expect(options.persistent).toStrictEqual(true)
    })

    it('should not mutate the message', async () => {
      await channel.consume(queue, consumer)

      const message = delivery({})

      await deliver(message)

      expect(message.properties.headers).toBeUndefined()
    })

    it('should emit the `retry` event', async () => {
      const listener = jest.fn()

      channel.diagnose('retry', listener)

      await channel.consume(queue, consumer)

      const message = delivery()

      await deliver(message)

      expect(listener).toHaveBeenCalledWith(message, exception, 1)
    })

    it('should not throw', async () => {
      // amqplib drops the promise it gets back, so a rejection ends the process
      await channel.consume(queue, consumer)

      await expect(deliver(delivery())).resolves.not.toThrow()
    })

    it('should not seal the channel', async () => {
      await channel.consume(queue, consumer)

      await deliver(delivery())

      expect(chan.cancel).not.toHaveBeenCalled()
    })

    it('should keep consuming', async () => {
      const another = generate()

      await channel.consume(queue, consumer)
      await deliver(delivery())

      await expect(channel.consume(another, jest.fn())).resolves.not.toThrow()

      expect(chan.consume).toHaveBeenCalledWith(another, expect.any(Function), expect.anything())
    })

    it('should ignore an exception thrown after the channel closed', async () => {
      await channel.consume(queue, consumer)

      consumer.mockImplementationOnce(async () => { throw new Error('Channel closed') })

      await expect(deliver(delivery())).resolves.not.toThrow()

      expect(chan.publish).not.toHaveBeenCalled()
      expect(chan.ack).not.toHaveBeenCalled()
      expect(chan.nack).not.toHaveBeenCalled()
    })

    it('should tolerate a rejection that is not an Error', async () => {
      await channel.consume(queue, consumer)

      consumer.mockImplementationOnce(async () => { throw undefined }) // eslint-disable-line

      await expect(deliver(delivery())).resolves.not.toThrow()

      expect(chan.publish).toHaveBeenCalled()
    })
  })

  describe('the healthy path', () => {
    it('should not make ordinary publishing persistent', async () => {
      // only a message that has already failed is worth a disk write; Requests are
      // transient for the sake of latency and must stay that way
      jest.clearAllMocks()

      topology.persistent = false
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.send(generate(), randomBytes(8))
      await channel.publish(generate(), randomBytes(8))

      for (const [, , , options] of chan.publish.mock.calls) {
        expect(options.persistent).toStrictEqual(false)
      }
    })
  })

  describe('backoff', () => {
    const LADDER = [1000, 5000, 25000]

    /** @returns {string[]} the retry queues asserted, in order */
    const asserted = () => chan.assertQueue.mock.calls
      .map(([name]) => name)
      .filter((name) => name.startsWith('comq.retry.'))

    beforeEach(async () => {
      jest.clearAllMocks()

      topology.delay = LADDER

      channel = await create(connection, topology)
      chan = await getCreatedChannel()
    })

    it('should declare a queue and an exchange per rung', async () => {
      await channel.consume(queue, consumer)

      expect(asserted()).toStrictEqual(LADDER.map((delay) => 'comq.retry.' + delay))

      for (const delay of LADDER) {
        const name = 'comq.retry.' + delay

        expect(chan.assertExchange).toHaveBeenCalledWith(name, 'fanout', expect.anything())
        expect(chan.bindQueue).toHaveBeenCalledWith(name, name, '')

        const [, options] = chan.assertQueue.mock.calls.find(([asserted]) => asserted === name)

        expect(options.arguments['x-message-ttl']).toStrictEqual(delay)
      }
    })

    it('should declare a repeated rung once', async () => {
      jest.clearAllMocks()

      topology.delay = [1000, 5000, 1000]
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      expect(asserted()).toStrictEqual(['comq.retry.1000', 'comq.retry.5000'])
    })

    it('should climb the ladder', async () => {
      await channel.consume(queue, consumer)

      await deliver(delivery({}))
      await deliver(delivery({ headers: { 'x-comq-attempt': 2 } }))
      await deliver(delivery({ headers: { 'x-comq-attempt': 3 } }))
      await deliver(delivery({ headers: { 'x-comq-attempt': 4 } }))

      expect(publications().map(([exchange]) => exchange)).toStrictEqual([
        'comq.retry.1000',
        'comq.retry.5000',
        'comq.retry.25000',
        '' // parked
      ])
    })

    it('should take a number as a ladder of one', async () => {
      jest.clearAllMocks()

      topology.delay = 1000

      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      await deliver(delivery({}))
      await deliver(delivery({ headers: { 'x-comq-attempt': 2 } }))

      expect(asserted()).toStrictEqual(['comq.retry.1000'])
      expect(publications().map(([exchange, key]) => exchange || key))
        .toStrictEqual(['comq.retry.1000', 'comq.parked.' + queue])
    })
  })

  describe('parking', () => {
    const exhausted = () => delivery({ headers: { 'x-comq-attempt': 5 } })

    it('should publish to the parked queue once the attempts are spent', async () => {
      await channel.consume(queue, consumer)

      await deliver(exhausted())

      const [exchange, key] = publications()[0]

      expect(exchange).toStrictEqual('')
      expect(key).toStrictEqual('comq.parked.' + queue)
    })

    it('should not retry once the attempts are spent', async () => {
      await channel.consume(queue, consumer)

      await deliver(exhausted())

      expect(publications()).toHaveLength(1)
      expect(chan.nack).not.toHaveBeenCalled()
    })

    it('should publish before acknowledging', async () => {
      await channel.consume(queue, consumer)

      await deliver(exhausted())

      expect(chan.publish.mock.invocationCallOrder[0])
        .toBeLessThan(chan.ack.mock.invocationCallOrder[0])
    })

    it('should record where the message came from', async () => {
      await channel.consume(queue, consumer)

      const origin = generate()
      const message = delivery({ headers: { 'x-comq-attempt': 5, 'x-comq-exchange': origin } })

      await deliver(message)

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-exchange']).toStrictEqual(origin)
      expect(options.headers['x-comq-queue']).toStrictEqual(queue)
      expect(options.headers['x-comq-reason']).toStrictEqual(exception.message)
      expect(options.headers['x-comq-at']).toStrictEqual(expect.any(Number))
    })

    it('should keep replyTo and correlationId', async () => {
      // a parked Request remains answerable while its caller is still waiting
      await channel.consume(queue, consumer)

      const replyTo = generate()
      const correlationId = generate()

      await deliver(delivery({ headers: { 'x-comq-attempt': 5 }, replyTo, correlationId }))

      const [, , , options] = publications()[0]

      expect(options.replyTo).toStrictEqual(replyTo)
      expect(options.correlationId).toStrictEqual(correlationId)
    })

    it('should publish persistent from a transient topology', async () => {
      await channel.consume(queue, consumer)

      await deliver(exhausted())

      const [, , , options] = publications()[0]

      expect(options.persistent).toStrictEqual(true)
    })

    it('should count the first delivery as an attempt', async () => {
      // a ladder of one rung is a single retry, so the second delivery is the last
      jest.clearAllMocks()

      topology.delay = 1000
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      await deliver(delivery({}))
      await deliver(delivery({ headers: { 'x-comq-attempt': 2 } }))

      const targets = publications().map(([, key]) => key)

      expect(targets).toStrictEqual([queue, 'comq.parked.' + queue])
    })

    it('should give a message one delivery more than the ladder has rungs', async () => {
      jest.clearAllMocks()

      topology.delay = [1000, 2000]
      channel = await create(connection, topology)
      chan = await getCreatedChannel()

      await channel.consume(queue, consumer)

      await deliver(delivery({}))
      await deliver(delivery({ headers: { 'x-comq-attempt': 2 } }))
      await deliver(delivery({ headers: { 'x-comq-attempt': 3 } }))

      const targets = publications().map(([, key]) => key)

      expect(targets).toStrictEqual([queue, queue, 'comq.parked.' + queue])
    })
  })

  describe('verdicts', () => {
    it('should park on the first delivery when the consumer says to', async () => {
      await channel.consume(queue, consumer)

      consumer.mockImplementationOnce(async () => { throw new Park(generate()) })

      await deliver(delivery({}))

      const [exchange, key] = publications()[0]

      expect(exchange).toStrictEqual('')
      expect(key).toStrictEqual('comq.parked.' + queue)
      expect(publications()).toHaveLength(1)
    })

    it('should not retry a parked message even with the ladder untouched', async () => {
      await channel.consume(queue, consumer)

      consumer.mockImplementationOnce(async () => { throw new Park(generate()) })

      await deliver(delivery({}))

      const [, , , options] = publications()[0]

      // parked on the first delivery, so it never climbed a rung
      expect(options.headers['x-comq-attempt']).toBeUndefined()
    })

    it('should treat Retry exactly as a bare rejection', async () => {
      await channel.consume(queue, consumer)

      consumer.mockImplementationOnce(async () => { throw new Retry(generate()) })

      await deliver(delivery({}))

      const [exchange] = publications()[0]

      expect(exchange).toStrictEqual('comq.retry.' + DELAY)
    })

    it('should record the verdict message as the reason', async () => {
      await channel.consume(queue, consumer)

      const reason = generate()

      consumer.mockImplementationOnce(async () => { throw new Park(reason) })

      await deliver(delivery({}))

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-reason']).toStrictEqual(reason)
    })

    it('should record the cause alongside the reason', async () => {
      await channel.consume(queue, consumer)

      const reason = generate()
      const cause = new Error(generate())

      consumer.mockImplementationOnce(async () => { throw new Park(reason, { cause }) })

      await deliver(delivery({}))

      const [, , , options] = publications()[0]

      expect(options.headers['x-comq-reason']).toStrictEqual(reason)
      expect(options.headers['x-comq-cause']).toStrictEqual(cause.message)
    })

    it('should emit `discard` for a parked verdict', async () => {
      const listener = jest.fn()

      channel.diagnose('discard', listener)

      await channel.consume(queue, consumer)

      const park = new Park(generate())

      consumer.mockImplementationOnce(async () => { throw park })

      const message = delivery({})

      await deliver(message)

      expect(listener).toHaveBeenCalledWith(message, park)
    })

    it('should honour a Park thrown by another copy of comq', async () => {
      await channel.consume(queue, consumer)

      const foreign = new Error(generate())

      foreign[Symbol.for('comq.verdict')] = 'park'

      consumer.mockImplementationOnce(async () => { throw foreign })

      await deliver(delivery({}))

      expect(publications()[0][1]).toStrictEqual('comq.parked.' + queue)
    })
  })

  describe('when the message cannot be moved', () => {
    it('should give the delivery back', async () => {
      await channel.consume(queue, consumer)

      chan.publish.mockImplementation(() => { throw new Error(generate()) })

      await expect(deliver(delivery())).resolves.not.toThrow()

      expect(chan.nack).toHaveBeenCalledWith(expect.anything(), false, true)
      expect(chan.ack).not.toHaveBeenCalled()
    })

    it('should give it back when the confirmation is rejected', async () => {
      await channel.consume(queue, consumer)

      chan.publish.mockImplementationOnce((_0, _1, _2, _3, callback) => callback(new Error(generate())))

      await expect(deliver(delivery())).resolves.not.toThrow()

      expect(chan.nack).toHaveBeenCalledWith(expect.anything(), false, true)
      expect(chan.ack).not.toHaveBeenCalled()
    })

    it('should not throw when giving it back also fails', async () => {
      await channel.consume(queue, consumer)

      chan.publish.mockImplementation(() => { throw new Error(generate()) })
      chan.nack.mockImplementation(() => { throw new Error('Channel closed') })

      await expect(deliver(delivery())).resolves.not.toThrow()
    })
  })
})
