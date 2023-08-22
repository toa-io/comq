'use strict'

const { EventEmitter } = require('node:events')
const { lazy, recall, promex, failsafe, timeout } = require('@toa.io/generic')

/**
 * @implements {comq.Channel}
 */
class Channel {
  index

  /** @type {comq.amqp.Connection} */
  #connection

  /** @type {comq.Topology} */
  #topology

  /** @type {comq.amqp.Channel} */
  #channel

  /** @type {boolean} */
  #failfast

  /** @type {string[]} */
  #tags = []

  /** @type {toa.generic.Promex} */
  #paused

  /** @type {boolean} */
  #sealed = false

  /** @type {toa.generic.Promex} */
  #recovery = promex()

  /** @type {Set<toa.generic.Promex>} */
  #confirmations = new Set()

  #diagnostics = new EventEmitter()

  /**
   * @param {comq.amqp.Connection} connection
   * @param {comq.Topology} topology
   * @param {number} index
   */
  constructor (connection, topology, index) {
    this.index = index

    this.#connection = connection
    this.#topology = topology
    this.#failfast = index !== undefined

    if (this.#failfast) failsafe.disable(this.send, this.publish)
  }

  async create () {
    if (this.#topology.confirms) this.#channel = await this.#connection.createConfirmChannel()
    else this.#channel = await this.#connection.createChannel()
  }

  consume = recall(this,
    failsafe(this, this.#recover,
      lazy(this, this.#assertQueue,
        /**
         * @param {string} queue
         * @param {comq.channels.consumer} callback
         */
        async (queue, callback) => {
          if (!this.#sealed) await this.#consume(queue, callback)
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
          if (!this.#sealed) await this.#consume(queue, callback)
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
       * @param {comq.amqp.options.Publish} [options]
       */
      async (exchange, buffer, options) => {
        await this.#publish(exchange, DEFAULT, buffer, options)
      }))

  async fire (queue, buffer, options) {
    try {
      await this.#publish(DEFAULT, queue, buffer, options)
    } catch (exception) {
      if (this.#failfast) throw exception
      // ignore otherwise
    }
  }

  async seal () {
    this.#sealed = true

    const cancellations = this.#tags.map((tag) => this.#channel.cancel(tag))

    await Promise.all(cancellations).catch(noop) // won't recover anyway
  }

  diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  async recover (connection) {
    this.#connection = connection

    await this.create()

    lazy.reset(this)
    await recall(this)

    this.#unpause(INTERRUPTION)

    for (const confirmation of this.#confirmations) confirmation.reject(INTERRUPTION)

    await timeout(0) // let unpause and confirmation interruptions be handled

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
    /** @type {comq.amqp.options.Exchange} */
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
    if (this.#paused !== undefined) await this.#unpaused()

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
    /** @type {comq.amqp.options.Consume} */
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
        if (exception.message === 'Channel closed') return // the message will be requeued by the broker

        if (message.fields.redelivered) this.#discard(message, exception)
        else this.#requeue(message)
      }
    }

  /**
   * @param {comq.amqp.Message} message
   */
  #requeue (message) {
    this.#channel.nack(message, false, true)
  }

  /**
   * @param {comq.amqp.Message} message
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
    this.#diagnostics.emit('pause')
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
    this.#diagnostics.emit('resume')
  }

  async #unpaused () {
    if (this.#failfast) throw INTERRUPTION // tell shards.Channel to remove this one from the pool
    else await this.#paused
  }

  async #recover (exception) {
    if (permanent(exception)) return false
    else await this.#recovery
  }
}

/**
 * @param {comq.amqp.Connection} connection
 * @param {comq.Topology} topology
 * @param {number} [index]
 * @return {Promise<comq.Channel>}
 */
async function create (connection, topology, index) {
  const channel = new Channel(connection, topology, index)

  await channel.create()

  return channel
}

/**
 * @return {boolean}
 */
function permanent (exception) {
  const closed = exception.message === 'Channel closed'
  const ended = exception.message === 'Channel ended, no reply will be forthcoming'
  const internal = exception === INTERRUPTION

  return !closed && !ended && !internal
}

const DEFAULT = ''

/** @type {comq.amqp.options.Queue} */
const DURABLE = { durable: true }

/** @type {comq.amqp.options.Queue} */
const EXCLUSIVE = { exclusive: true }

const INTERRUPTION = /** @type {Error} */ Symbol('internal interruption')

function noop () {}

exports.create = create
