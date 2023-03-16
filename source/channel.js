'use strict'

const { EventEmitter } = require('node:events')
const { lazy, recall, promex, failsafe, immediate } = require('@toa.io/generic')

/**
 * @implements {comq.Channel}
 */
class Channel {
  /** @type {comq.Topology} */
  #topology

  /** @type {comq.amqp.Channel} */
  #channel

  /** @type {string[]} */
  #tags = []

  /** @type {toa.generic.Promex} */
  #paused

  /** @type {toa.generic.Promex} */
  #recovery = promex()

  /** @type {Set<toa.generic.Promex>} */
  #confirmations = new Set()

  #diagnostics = new EventEmitter()

  /**
   * @param {comq.Topology} topology
   */
  constructor (topology) {
    this.#topology = topology
  }

  async create (connection) {
    const method = `create${this.#topology.confirms ? 'Confirm' : ''}Channel`

    this.#channel = await connection[method]()
  }

  consume = recall(this,
    failsafe(this, this.#recover,
      lazy(this, this.#assertQueue,
        /**
         * @param {string} queue
         * @param {comq.channels.consumer} callback
         */
        async (queue, callback) => {
          await this.#consume(queue, callback)
        })))

  subscribe = recall(this,
    failsafe(this, this.#recover,
      lazy(this, [this.#assertExchange, this.#assertBoundQueue],
        /**
         * @param {string} exchange
         * @param {string} queue
         * @param {comq.channels.consumer} callback
         * @returns {Promise<void>}
         */
        async (exchange, queue, callback) => {
          await this.#consume(queue, callback)
        })))

  send = failsafe(this, this.#recover,
    lazy(this, this.#assertQueue,
      /**
       * @param {string} queue
       * @param {Buffer} buffer
       * @param {comq.amqp.options.Publish} options
       */
      async (queue, buffer, options) => {
        await this.#publish(DEFAULT, queue, buffer, options)
      }))

  publish = failsafe(this, this.#recover,
    lazy(this, this.#assertExchange,
      /**
       * @param {string} exchange
       * @param {Buffer} buffer
       * @param {import('amqplib').Options.Publish} [options]
       */
      async (exchange, buffer, options) => {
        await this.#publish(exchange, DEFAULT, buffer, options)
      }))

  async throw (queue, buffer, options) {
    try {
      await this.#publish(DEFAULT, queue, buffer, options)
    } catch {
      // whatever
    }
  }

  async seal () {
    const cancellations = this.#tags.map((tag) => this.#channel.cancel(tag))

    await Promise.all(cancellations)
  }

  diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  async recover (connection) {
    await this.create(connection)

    lazy.reset(this)
    await recall(this)

    this.#unpause(REJECTION)

    for (const confirmation of this.#confirmations) confirmation.reject(REJECTION)

    // let unpause and confirmation rejections be handled
    await immediate()

    this.#recovery.resolve()
    this.#recovery = promex()
    this.#diagnostics.emit('recover')
  }

  // region initializers

  /**
   * @param {string} name
   * @returns {Promise<string[]>}
   */
  async #assertQueue (name) {
    const passed = arguments.length === 2 ? arguments[1] : undefined
    const options = passed ?? (this.#topology.durable ? DURABLE : EXCLUSIVE)

    const { queue } = await this.#channel.assertQueue(name, options)

    return [queue]
  }

  /**
   * @param {string} exchange
   * @returns {Promise<void>}
   */
  async #assertExchange (exchange) {
    /** @type {import('amqplib').Options.AssertExchange} */
    const options = { durable: this.#topology.durable }

    await this.#channel.assertExchange(exchange, 'fanout', options)
  }

  /**
   *
   * @param {string} exchange
   * @param {string} queue
   * @returns {Promise<string[]>}
   */
  async #assertBoundQueue (exchange, queue) {
    /** @type {comq.amqp.options.Consume} */
    let options

    if (queue === undefined) options = { exclusive: true }

    queue = (await this.#assertQueue(queue, options))[0]
    await this.#channel.bindQueue(queue, exchange, '')

    return [exchange, queue]
  }

  // endregion

  /**
   * @param {string} exchange
   * @param {string} queue
   * @param {Buffer} buffer
   * @param {comq.amqp.options.Publish} options
   */
  async #publish (exchange, queue, buffer, options) {
    if (this.#paused !== undefined) await this.#paused

    options = Object.assign({ persistent: this.#topology.persistent }, options)

    const confirmation = this.#topology.confirms ? this.#confirmation() : undefined
    const resume = this.#channel.publish(exchange, queue, buffer, options, confirmation?.callback)

    if (resume === false) this.#pause()

    return confirmation
  }

  /**
   * @return {toa.generic.Promex}
   */
  #confirmation () {
    const confirmation = promex()

    this.#confirmations.add(confirmation)

    confirmation
      .catch(noop) // have no idea why, but this is required
      .finally(() => this.#confirmations.delete(confirmation))

    return confirmation
  }

  /**
   * @param {string} queue
   * @param {comq.channels.consumer} consumer
   * @returns {Promise<void>}
   */
  async #consume (queue, consumer) {
    /** @type {import('amqplib').Options.Consume} */
    const options = {}

    if (this.#topology.acknowledgments) consumer = this.#getAcknowledgingConsumer(consumer)
    else options.noAck = true

    const response = await this.#channel.consume(queue, consumer, options)

    this.#tags.push(response.consumerTag)
  }

  /**
   * @param {comq.channels.consumer} consumer
   * @returns {comq.channels.consumer}
   */
  #getAcknowledgingConsumer = (consumer) =>
    async (message) => {
      try {
        await consumer(message)

        this.#channel.ack(message)
      } catch (exception) {
        if (exception.message === 'Channel closed') return // message will be requeued by the broker

        if (message.fields.redelivered) this.#discard(message, exception)
        else this.#requeue(message)
      }
    }

  /**
   * @param {import('amqplib').ConsumeMessage} message
   */
  #requeue (message) {
    this.#channel.nack(message, false, true)
  }

  /**
   * @param {import('amqplib').ConsumeMessage} message
   * @param {Error} [exception]
   */
  #discard (message, exception) {
    this.#channel.nack(message, false, false)
    this.#diagnostics.emit('discard', message, exception)
  }

  #pause () {
    if (this.#paused !== undefined) return

    this.#paused = promex()
    this.#channel.once('drain', this.#unpause)
    this.#diagnostics.emit('flow')
  }

  /**
   * @param {Error} [exception]
   */
  #unpause = (exception) => {
    if (this.#paused === undefined) return

    if (exception === undefined) this.#paused.resolve()
    else this.#paused.reject(exception)

    this.#paused = undefined
    this.#diagnostics.emit('drain')
  }

  async #recover (exception) {
    if (permanent(exception)) return false

    await this.#recovery
  }
}

/**
 * @param {comq.amqp.Connection} connection
 * @param {comq.Topology} topology
 * @return {Promise<comq.Channel>}
 */
const create = async (connection, topology) => {
  const channel = new Channel(topology)

  await channel.create(connection)

  return channel
}

/**
 * @return {boolean}
 */
const permanent = (exception) => {
  const closed = exception.message === 'Channel closed'
  const ended = exception.message === 'Channel ended, no reply will be forthcoming'
  const internal = exception === REJECTION
  const unpause = exception.pause === 1

  return !closed && !ended && !internal && !unpause
}

const DEFAULT = ''

/** @type {import('amqplib').Options.AssertQueue} */
const DURABLE = { durable: true }

/** @type {import('amqplib').Options.AssertQueue} */
const EXCLUSIVE = { exclusive: true }

const REJECTION = /** @type {Error} */ Symbol('rejection')

function noop () {}

exports.create = create
