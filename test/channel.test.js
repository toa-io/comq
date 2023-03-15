'use strict'

// region setup

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { flip, random } = require('@toa.io/generic')

const backpressure = require('./backpressure')
const { amqplib } = require('./amqplib.mock')
const fixtures = require('./channel.fixtures')
const { create } = require('../source/channel')

it('should be', async () => {
  expect(create).toBeDefined()
})

/** @type {jest.MockedObject<import('amqplib').Connection>} */
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

    const options = topology.durable ? { durable: true } : { exclusive: true }

    expect(chan.assertQueue).toHaveBeenCalledWith(queue, options)
  })

  it('should start consuming (ack: %s)', async () => {
    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())

    const content = randomBytes(8)
    const message = /** @type {import('amqplib').ConsumeMessage} */ { content }
    const callback = chan.consume.mock.calls[0][1]

    await callback(message)

    expect(consumer).toHaveBeenCalledWith(message)
  })
})

describe('acknowledgements', () => {
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(async () => undefined)
  const queue = generate()

  it.each([
    ['', true],
    ['not ', false]
  ])('should %sack incoming messages', async (_, ack) => {
    topology.acknowledgements = ack
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    const callback = chan.consume.mock.calls[0][1]
    const content = randomBytes(8)
    const message = /** @type {import('amqplib').ConsumeMessage} */ { content }

    await callback(message)

    if (ack) expect(chan.ack).toHaveBeenCalledWith(message)
    else expect(chan.ack).not.toHaveBeenCalled()
  })

  it.each([
    ['manual', true],
    ['automatic', false]
  ])('should create consumer with %s acknowledgements', async (_, ack) => {
    topology.acknowledgements = ack
    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.consume(queue, consumer)

    const options = chan.consume.mock.calls[0][2]

    if (ack) expect(options).not.toMatchObject({ noAck: true })
    else expect(options).toMatchObject({ noAck: true })
  })

  it.each(/** @type {[string, boolean][]} */ [
    ['nack', true],
    ['discard', false]
  ])('should %s the message caused an exception', async (_, requeue) => {
    topology.acknowledgements = true

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    const consumer = /** @type {Function} */ jest.fn(async () => { throw new Error() })

    await channel.consume(queue, consumer)

    const callback = chan.consume.mock.calls[0][1]
    const content = randomBytes(8)
    const properties = {}
    const fields = {}
    const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties, fields }

    if (!requeue) fields.redelivered = !requeue

    await callback(message)

    expect(chan.nack).toHaveBeenCalledWith(message, false, requeue)
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

describe('throw', () => {
  const queue = generate()
  const buffer = randomBytes(10)
  const options = { contentType: 'application/octet-stream' }

  beforeEach(async () => {
    channel = await create(connection, topology)
    chan = await getCreatedChannel()
  })

  it('should be', async () => {
    expect(channel.throw).toBeDefined()
  })

  it('should publish a message', async () => {
    await channel.throw(queue, buffer, options)

    const call = chan.publish.mock.calls[0]

    expect(call[0]).toStrictEqual('') // default exchange
    expect(call[1]).toStrictEqual(queue)
    expect(call[2]).toStrictEqual(buffer)
    expect(call[3]).toMatchObject(options)
  })

  it('should catch exceptions', async () => {
    chan.publish.mockImplementation(() => { throw new Error() })

    await expect(channel.throw(queue, buffer, options)).resolves.not.toThrow()
  })
})

describe('subscribe', () => {
  const exchange = generate()
  const queue = generate()
  const consumer = /** @type {comq.channel.consumer} */ jest.fn(() => undefined)

  beforeEach(async () => {
    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.subscribe(exchange, queue, consumer)
  })

  it('should assert fanout exchange', async () => {
    expect(chan.assertExchange).toHaveBeenCalledTimes(1)

    const [name, type, options] = chan.assertExchange.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(type).toStrictEqual('fanout')

    if (topology.durable) expect(options).not.toMatchObject({ durable: false })
    else expect(options).toMatchObject({ durable: false })
  })

  it('should assert queue', async () => {
    const options = topology.durable ? { durable: true } : { exclusive: true }

    expect(chan.assertQueue).toHaveBeenCalledWith(queue, expect.objectContaining(options))
  })

  it('should bind queue to exchange', async () => {
    expect(chan.bindQueue).toHaveBeenCalledTimes(1)
    expect(chan.bindQueue).toHaveBeenCalledWith(queue, exchange, '')
  })

  it.each([
    ['with acknowledgements', true],
    ['without acknowledgements', false]
  ])('should start consuming %s', async (_, ack) => {
    topology.acknowledgements = ack

    jest.clearAllMocks()

    channel = await create(connection, topology)
    chan = await getCreatedChannel()

    await channel.subscribe(exchange, queue, consumer)

    const options = ack ? {} : { noAck: true }

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
      const queue = generate()
      const consumer = jest.fn()

      await channel.consume(queue, consumer)

      const { consumerTag: tag } = await chan.consume.mock.results[i].value

      expect(tag).toBeDefined()
      expect(tags.indexOf(tag)).toStrictEqual(-1)

      tags.push(tag)
    }

    await channel.seal()

    for (const tag of tags) expect(chan.cancel).toHaveBeenCalledWith(tag)
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

  it('should assert queue after recovery', async () => {
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

  it('should re-assert exchange after exception', async () => {
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

  it('should re-bind queue after exception', async () => {
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

  it('should re-consume after recovery', async () => {
    await channel.consume(queue, consumer)

    const replacement = await amqplib.connect()

    await channel.recover(replacement)

    const chan = await getCreatedChannel(replacement)

    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())
  })

  it('should re-consume after exception ', async () => {
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

    expect(repl.consume).toHaveBeenCalled()
  })

  it('should re-subscribe after recovery', async () => {
    await channel.subscribe(exchange, queue, consumer)

    const replacement = await amqplib.connect()

    await channel.recover(replacement)

    const repl = await getCreatedChannel(replacement)

    expect(repl.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())
  })

  it('should re-send after exception', async () => {
    const queue = generate()
    const buffer = Buffer.from(generate())

    /** @type {comq.amqp.Connection} */
    let replacement

    chan.publish.mockImplementation(() => { throw new Error('Channel closed') })

    setTimeout(async () => {
      expect(chan.publish).toHaveBeenCalled()

      chan.publish.mockImplementation(async () => {})
      replacement = await amqplib.connect()

      await channel.recover(replacement)
    }, 1)

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

    chan.publish.mockImplementation(() => true)

    /** @type {jest.MockedObject<comq.amqp.Connection>} */
    let replacement

    setImmediate(async () => {
      replacement = await amqplib.connect()

      await channel.recover(replacement)
    })

    await channel.publish(exchange, buffer, options)

    expect(replacement).toBeDefined()

    const repl = await getCreatedChannel(replacement)

    expect(repl.publish).toHaveBeenCalledWith(
      exchange, '', buffer, expect.objectContaining(options), expect.any(Function)
    )
  })

  it('should unpause on recovery', async () => {
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

    channel.diagnose('flow', () => (flowed = true))
    channel.diagnose('drain', () => (drained = true))

    await channel.publish(exchange, buffer)

    expect(flowed).toStrictEqual(true)

    chan.emit('drain')

    expect(drained).toStrictEqual(true)
  })

  it.each(/** @type {[string, boolean][]} */ [
    ['', true],
    [' not', false]
  ])('should%s emit `discard` event', async (_, redelivered) => {
    jest.clearAllMocks()

    topology.acknowledgements = true
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
    const properties = {}
    const fields = { redelivered }
    const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties, fields }

    await callback(message)

    if (redelivered) expect(listener).toHaveBeenCalledWith(message, exception)
    else expect(listener).not.toHaveBeenCalled()
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
