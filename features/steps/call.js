'use strict'

const assert = require('node:assert')
const amqplib = require('amqplib')
const { Given, When, Then, After } = require('@cucumber/cucumber')

const { connect, Unroutable } = require('../../')
const { parse } = require('./yaml')
const { getAddress, USER, PASSWORD } = require('./brokers')
const { timeout, until } = require('../../test/helpers')

Given('a holder answering {token} under the {token} key:',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {string} javascript
   * @this {comq.features.Context}
   */
  async function (exchange, key, javascript) {
    // eslint-disable-next-line no-new-func
    const producer = new Function('return ' + javascript)()

    this.io.diagnose('taken', () => (this.taken = true))

    await this.io.back(exchange, key, producer)
  })

Given('a holder on another connection answering {token} under the {token} key',
  /**
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    this.holder = await another(this)

    await this.holder.back(exchange, key, echo)
  })

Given('a holder on another connection answering {token} under the {token} key in {number}ms',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} delay
   * @this {comq.features.Context}
   */
  async function (exchange, key, delay) {
    this.holder = await another(this)

    await this.holder.back(exchange, key, async (payload) => {
      await timeout(delay)

      return echo(payload)
    })
  })

Given('a holder connected to broker {number} answering {token} under the {token} key',
  /**
   * @param {number} broker
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (broker, exchange, key) {
    this.holder = await another(this, broker)

    await this.holder.back(exchange, key, echo)
  })

Given('a holder never answering {token} under the {token} key',
  /**
   * Holds the key as comq does, and takes a Request without ever answering it, so that losing
   * its connection loses the Request with it.
   *
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    const connection = await amqplib.connect(url(0))
    const channel = await connection.createChannel()
    const queue = exchange + '.' + key

    await channel.assertExchange(exchange, 'direct', { durable: true })
    await channel.assertQueue(queue, { exclusive: true })
    await channel.bindQueue(queue, exchange, key)
    await channel.consume(queue, () => undefined)

    this.silent = connection
  })

When('the silent holder crashes',
  /**
   * Its socket is destroyed without a word, as a process that dies leaves it.
   *
   * @this {comq.features.Context}
   */
  function () {
    const connection = this.silent

    this.silent = undefined

    connection.on('error', () => undefined)
    connection.connection.stream.destroy()
  })

When('the consumer calls {token} under the {token} key',
  /**
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    call(this, this.io.call(exchange, key, { key }))
  })

When('the consumer calls {token} under the {token} key with:',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (exchange, key, yaml) {
    call(this, this.io.call(exchange, key, parse(yaml)))
  })

When('the consumer calls {token} under the {token} key with a {number}ms timeout',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (exchange, key, ms) {
    call(this, this.io.call(exchange, key, { key }, { timeout: ms }))
  })

When('the consumer calls {token} under the {token} key {number} times',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} times
   * @this {comq.features.Context}
   */
  async function (exchange, key, times) {
    const calls = Array.from({ length: times }, (_, n) => this.io.call(exchange, key, n))

    this.replies = await Promise.all(calls)
  })

When('the consumer sends a request to the {token} queue with a {number}ms timeout',
  /**
   * @param {string} queue
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (queue, ms) {
    call(this, this.io.request(queue, { queue }, { timeout: ms }))
  })

When('the holder is sealed',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.holder.seal()
  })

When('a second holder on another connection holds {token} under the {token} key',
  /**
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    const second = await another(this)

    second.diagnose('taken', () => (this.taken = true))

    this.holding = second.back(exchange, key, echo)

    // asserted on by a later step, and an unhandled rejection would end the run before it
    this.holding.catch(() => undefined)
  })

When('the first holder disconnects',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.holder.close()
  })

When('a producer counting requests to the {token} queue',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    this.produced = 0

    await this.io.reply(queue, () => {
      this.produced++

      return null
    })
  })

Then('the call is refused as unroutable',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await assert.rejects(this.reply, (error) => error instanceof Unroutable)
  })

Then('the consumer stops waiting',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await assert.rejects(this.reply, (error) => error.name === 'TimeoutError')
  })

Given('a holder connected to broker {number} answering {token} under the {token} key as {token}',
  /**
   * @param {number} broker
   * @param {string} exchange
   * @param {string} key
   * @param {string} name
   * @this {comq.features.Context}
   */
  async function (broker, exchange, key, name) {
    this.holder = await another(this, broker)

    await this.holder.back(exchange, key, () => name)
  })

When('a second holder on another connection holds {token} under the {token} key as {token}',
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {string} name
   * @this {comq.features.Context}
   */
  async function (exchange, key, name) {
    const second = await another(this)

    second.diagnose('taken', () => (this.taken = true))

    await second.back(exchange, key, () => name)
  })

Then('the second holder finds the key taken',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.equal(await until(() => this.taken === true), true, 'The key was not found taken')
  })

Then('every call to {token} under the {token} key is answered by {token} within {number} seconds', { timeout: 120_000 },
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {string} name
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (exchange, key, name, seconds) {
    const answered = await eventually(async () => {
      const calls = Array.from({ length: 20 }, () => this.io.call(exchange, key, null, { timeout: 1000 }))
      const replies = await Promise.all(calls)

      if (!replies.every((reply) => reply === name)) throw new Error('Answered by another')
    }, seconds)

    assert.equal(answered, true, `Calls were not all answered by ${name}`)
  })

Then('the second holder holds the key',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.holding
  })

Then('the holder finds its key taken while the broker holds the silent connection', { timeout: 60_000 },
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.equal(await until(() => this.taken === true, 50_000), true, 'The key was not found taken')
  })

Then('a call to {token} under the {token} key is answered within {number} seconds', { timeout: 120_000 },
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (exchange, key, seconds) {
    const answered = await eventually(() => this.io.call(exchange, key, { key }, { timeout: 1000 }), seconds)

    assert.equal(answered, true, 'The call was not answered')
  })

Then('a call to {token} under the {token} key from another connection is answered within {number} seconds', { timeout: 120_000 },
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (exchange, key, seconds) {
    const caller = await another(this)
    const answered = await eventually(() => caller.call(exchange, key, { key }, { timeout: 1000 }), seconds)

    assert.equal(answered, true, 'The call was not answered')
  })

Then('a call to {token} under the {token} key is refused within {number} seconds', { timeout: 60_000 },
  /**
   * @param {string} exchange
   * @param {string} key
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (exchange, key, seconds) {
    const refused = await eventually(async () => {
      try {
        await this.io.call(exchange, key, { key }, { timeout: 1000 })
      } catch (error) {
        if (error instanceof Unroutable) return

        throw error
      }

      throw new Error('Answered')
    }, seconds)

    assert.equal(refused, true, 'The call was not refused')
  })

Then('the call ends', { timeout: 90_000 },
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.reply.catch(() => undefined)
  })

Then('the consumer stops waiting within {number} second(s)', { timeout: 90_000 },
  /**
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (seconds) {
    const stopped = this.reply.then(() => 'answered', (error) => error.name === 'TimeoutError' ? 'stopped' : error.message)
    const late = timeout(seconds * 1000).then(() => 'still waiting')

    assert.equal(await Promise.race([stopped, late]), 'stopped')
  })

Then('every call is answered',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.deepEqual(this.replies, this.replies.map((_, n) => n))
  })

Then('the producer receives nothing',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await timeout(500)

    assert.equal(this.produced, 0, 'An expired request was processed')
  })

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await Promise.all((this.holders ?? []).map((io) => io.close()))
    await this.silent?.close().catch(() => undefined)

    this.holders = []
    this.silent = undefined
  })

/**
 * Another connection, to the brokers the consumer is connected to, or to one of them.
 *
 * @param {comq.features.Context} context
 * @param {number} [broker]
 * @returns {Promise<comq.IO>}
 */
async function another (context, broker) {
  const urls = broker !== undefined
    ? [url(broker)]
    : context.sharded ? [url(0), url(1)] : [url(0)]

  const io = await connect(...urls)

  context.holders ??= []
  context.holders.push(io)

  return io
}

/**
 * @param {comq.features.Context} context
 * @param {Promise<any>} reply
 */
function call (context, reply) {
  // asserted on by a later step, and an unhandled rejection would end the run before it
  reply.catch(() => undefined)

  context.reply = reply
}

/**
 * @param {number} broker
 * @returns {string}
 */
function url (broker) {
  return `amqp://${USER}:${PASSWORD}@${getAddress(broker)}`
}

/**
 * Makes an attempt until it succeeds, or until the time is up.
 *
 * @param {() => Promise<unknown>} attempt
 * @param {number} seconds
 * @returns {Promise<boolean>} whether it succeeded
 */
async function eventually (attempt, seconds) {
  const deadline = Date.now() + seconds * 1000

  while (Date.now() < deadline) {
    try {
      await attempt()

      return true
    } catch {
      await timeout(500)
    }
  }

  return false
}

function echo (payload) {
  return payload
}
