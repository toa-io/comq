'use strict'

const { generate } = require('randomstring')

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

const getCreatedChannel = () => {
  const method = `create${topology.confirms ? 'Confirm' : ''}Channel`

  return connection[method].mock.results[0].value
}

beforeEach(async () => {
  jest.clearAllMocks()

  connection = await amqplib.connect()
  topology = fixtures.preset()
  channel = await create(connection, topology)
  chan = await getCreatedChannel()
})

describe('route', () => {
  const buffer = Buffer.from(generate())

  it('should assert a direct exchange', async () => {
    await channel.route(exchange, key, buffer)

    expect(chan.assertExchange).toHaveBeenCalledTimes(1)

    const [name, type] = chan.assertExchange.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(type).toStrictEqual('direct')
  })

  it('should publish with the key as the routing key', async () => {
    await channel.route(exchange, key, buffer)

    const [name, routingKey, published] = chan.publish.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(routingKey).toStrictEqual(key)
    expect(published).toStrictEqual(buffer)
  })

  it('should assert the exchange once for many keys', async () => {
    await channel.route(exchange, key, buffer)
    await channel.route(exchange, generate(), buffer)

    expect(chan.assertExchange).toHaveBeenCalledTimes(1)
    expect(chan.publish).toHaveBeenCalledTimes(2)
  })
})

describe('bound', () => {
  const consumer = /** @type {comq.channels.Consumer} */ jest.fn(() => undefined)

  it('should assert a direct exchange', async () => {
    await channel.bound(exchange, queue, key, consumer)

    const [name, type] = chan.assertExchange.mock.calls[0]

    expect(name).toStrictEqual(exchange)
    expect(type).toStrictEqual('direct')
  })

  it('should assert the queue by name', async () => {
    await channel.bound(exchange, queue, key, consumer)

    expect(chan.assertQueue).toHaveBeenCalledWith(queue, expect.anything())
  })

  it('should bind the queue under the key', async () => {
    await channel.bound(exchange, queue, key, consumer)

    const { queue: asserted } = await chan.assertQueue.mock.results[0].value

    expect(chan.bindQueue).toHaveBeenCalledTimes(1)
    expect(chan.bindQueue).toHaveBeenCalledWith(asserted, exchange, key)
  })

  it('should consume the queue', async () => {
    await channel.bound(exchange, queue, key, consumer)

    expect(chan.consume).toHaveBeenCalledWith(queue, expect.any(Function), expect.anything())
  })

  it('should bind once per key', async () => {
    await channel.bound(exchange, queue, key, consumer)
    await channel.bound(exchange, queue, key, consumer)

    expect(chan.bindQueue).toHaveBeenCalledTimes(1)
  })

  it('should bind again for another key', async () => {
    await channel.bound(exchange, queue, key, consumer)
    await channel.bound(exchange, generate(), generate(), consumer)

    expect(chan.bindQueue).toHaveBeenCalledTimes(2)
  })
})
