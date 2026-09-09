'use strict'

const { Promex } = require('promex')
const { failsafe, lazy, recall } = require('./attributes')
const emitter = require('./emitter')

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

  /**
   * How each queue was declared, so that the queue holding what it could not
   * process is declared to live exactly as long as it does.
   *
   * @type {Map<string, comq.amqp.options.Queue>}
   */
  #queues = new Map()

  /** @type {Promex | null} */
  #paused = null

  /** @type {boolean} */
  #sealed = false

  /** @type {Promex} */
  #recovery = new Promex()

  /** @type {boolean} */
  #recovering = false

  /** @type {Set<Promex>} */
  #confirmations = new Set()

  #diagnostics = emitter.create()

  #closed = false

  /** @type {(channel: comq.Channel) => void} */
  #release

  /**
   * @param {comq.amqp.Connection} connection
   * @param {comq.Topology} topology
   * @param {number} [index]
   * @param {(channel: comq.Channel) => void} [release] called once the channel is given back
   */
  constructor (connection, topology, index, release = noop) {
    this.index = index

    this.#connection = connection
    this.#topology = topology
    this.#failfast = index !== undefined
    this.#release = release

    if (this.#failfast) failsafe.disable(this.send, this.publish)
  }

  async create () {
    if (this.#topology.confirms) this.#channel = await this.#connection.createConfirmChannel()
    else this.#channel = await this.#connection.createChannel()

    // the consumers of the previous channel went down with it, their tags mean nothing here
    this.#tags = []

    // a fresh channel has declared nothing
    this.#queues.clear()

    await this.#channel.prefetch(this.#topology.prefetch)

    this.#channel.on('drain', this.#unpause)
    this.#channel.on('return', (message) => this.#diagnostics.emit('return', message))
  }

  consume = recall(this,
    failsafe(this, this.#recover,
      lazy(this, this.#assertQueue,
        /**
         * @param {string} queue
         * @param {comq.channels.Consumer} callback
         */
        async (queue, callback) => {
          if (!this.#sealed) return await this.#consume(queue, callback)
        })))

  subscribe = recall(this,
    failsafe(this, this.#recover,
      lazy(this, [this.#assertExchange, this.#assertBoundQueue],
        /**
         * @param {string} exchange
         * @param {string} queue
         * @param {comq.channels.Consumer} callback
         * @returns {Promise<void>}
         */
        async (exchange, queue, callback) => {
          if (!this.#sealed) await this.#consume(queue, callback)
        })))

  /**
   * Consumes a named queue bound to a direct exchange under a routing key, where `subscribe`
   * binds to a fanout and takes everything published to it.
   */
  bound = recall(this,
    failsafe(this, this.#recover,
      lazy(this, [this.#assertRouted, this.#assertKeyedQueue],
        /**
         * @param {string} exchange
         * @param {string} queue
         * @param {string} key
         * @param {comq.channels.Consumer} callback
         * @returns {Promise<void>}
         */
        async (exchange, queue, key, callback) => {
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

  /**
   * Publishes to a direct exchange under a routing key, where `publish` fans out.
   */
  route = failsafe(this, this.#recover,
    lazy(this, this.#assertRouted,
      /**
       * @param {string} exchange
       * @param {string} key
       * @param {Buffer} buffer
       * @param {comq.amqp.options.Publish} [options]
       */
      async (exchange, key, buffer, options) => {
        await this.#publish(exchange, key, buffer, options)
      }))

  async fire (queue, buffer, options) {
    try {
      await this.#publish(DEFAULT, queue, buffer, options)

      return true
    } catch (exception) {
      if (this.#failfast) throw exception
      // ignore otherwise

      return false
    }
  }

  /**
   * Gives the channel back. A connection has a limited number of them, and one whose
   * IO is done with it would otherwise be held until the whole connection goes.
   */
  async close () {
    if (this.#closed) return

    this.#closed = true

    await this.seal()

    // a channel that went down with its connection is the outcome this asks for
    await this.#channel?.close().catch(noop)

    this.#release(this)
  }

  async seal () {
    this.#sealed = true

    const cancellations = this.#tags.map((tag) => this.#channel.cancel(tag))

    await Promise.all(cancellations).catch(noop) // won't recover anyway

    // a sealed channel is not going to consume again, so what it has consumed
    // and the callbacks it was given are of no use anymore
    recall.reset(this)
  }

  diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  forget (event, listener) {
    this.#diagnostics.off(event, listener)
  }

  get closed () {
    return this.#closed
  }

  async recover (connection) {
    this.#connection = connection

    await this.create()

    lazy.reset(this)

    this.#recovering = true

    try {
      await recall(this)
    } finally {
      this.#recovering = false
    }

    this.#unpause(INTERRUPTION)

    for (const confirmation of this.#confirmations) confirmation.reject(INTERRUPTION)

    // handle interruptions
    await new Promise(resolve => setTimeout(resolve, 0))

    this.#recovery.resolve()
    this.#recovery = new Promex()
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

    this.#queues.set(queue, options)

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
   * A routed exchange is `direct`: a message reaches the queues bound under the key it was
   * published with, and none of the others.
   *
   * @param {string} exchange
   * @returns {Promise<void>}
   */
  async #assertRouted (exchange) {
    /** @type {comq.amqp.options.Exchange} */
    const options = { durable: this.#topology.durable }

    await this.#channel.assertExchange(exchange, 'direct', options)
  }

  /**
   * @param {string} exchange
   * @param {string} queue
   * @param {string} key
   * @returns {Promise<string[]>}
   */
  async #assertKeyedQueue (exchange, queue, key) {
    queue = (await this.#assertQueue(queue))[0]
    await this.#channel.bindQueue(queue, exchange, key)

    return [exchange, queue, key]
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

  /**
   * The queue a failed message waits in before it is delivered again. It has no consumer:
   * the broker holds the message for the delay and then dead letters it, and because no
   * routing key is configured the message keeps its own, which names the queue it came
   * from. One queue serves every source queue that shares the delay.
   *
   * It is published to through a fanout exchange rather than directly. Published directly,
   * the message's routing key would be this queue's own name, and on expiry the broker
   * would route it back here — a cycle it resolves by dropping the message at the first
   * expiry, silently.
   *
   * @returns {Promise<void>}
   */
  async #assertRetryQueue () {
    if (!this.#topology.acknowledgments) return

    // one queue per distinct wait, declared here rather than when a message first fails:
    // asserting a queue from inside the failure handler is the least likely moment for it
    // to succeed, and a failure there would spin the message without ever delaying it
    for (const delay of new Set(this.#delays)) {
      const name = RETRY_PREFIX + delay

      await this.#channel.assertExchange(name, 'fanout', DURABLE)

      await this.#assertQueue(name, {
        ...DURABLE,
        arguments: {
          'x-message-ttl': delay,
          'x-dead-letter-exchange': DEFAULT
        }
      })

      await this.#channel.bindQueue(name, name, DEFAULT)
    }
  }

  /**
   * The queue a message is kept in once it has run out of attempts. It has no consumer
   * either: what is in it is waiting for a person.
   *
   * It is declared to live exactly as long as the queue it serves, which for a groupless
   * subscriber means an exclusive queue whose contents go when the connection does. That
   * is deliberate: such a subscriber is ephemeral by construction, and a durable queue per
   * generated name would leak one per restart, forever. An ephemeral subscriber's failures
   * are ephemeral too.
   *
   * @param {string} queue the queue the message was consumed from
   * @returns {Promise<void>}
   */
  async #assertParkedQueue (queue) {
    if (!this.#topology.acknowledgments) return

    const options = this.#queues.get(queue) ?? (this.#topology.durable ? DURABLE : EXCLUSIVE)

    await this.#assertQueue(parkedQueueOf(queue), options)
  }

  /** The waits between attempts, as a ladder even when it is one rung. */
  get #delays () {
    const delay = this.#topology.delay

    return Array.isArray(delay) ? delay : [delay]
  }

  /**
   * The queue a message waits in after its nth attempt, and the exchange it is published
   * through: they share a name.
   *
   * @param {number} attempt the attempt that just failed, counting from one
   */
  #retryQueueOf (attempt) {
    return RETRY_PREFIX + this.#delays[attempt - 1]
  }

  // endregion

  /**
   * @param {string} exchange
   * @param {string} queue
   * @param {Buffer} buffer
   * @param {comq.amqp.options.Publish} options
   */
  async #publish (exchange, queue, buffer, options) {
    if (this.#paused !== null) await this.#unpaused()

    options = Object.assign({ persistent: this.#topology.persistent }, options)

    const confirmation = this.#topology.confirms ? this.#confirmation() : undefined
    const resume = this.#channel.publish(exchange, queue, buffer, options, confirmation?.callback)

    if (resume === false) this.#pause()

    return confirmation
  }

  /**
   * @return {Promex}
   */
  #confirmation () {
    const confirmation = new Promex()
    const settled = () => this.#confirmations.delete(confirmation)

    this.#confirmations.add(confirmation)

    // one derived promise per publish, and a rejection handled with it
    confirmation.then(settled, settled)

    return confirmation
  }

  /**
   * The retry topology is asserted once per channel and a parked queue once per queue:
   * `lazy` keys an initializer by the arguments it takes, and both again after a recovery.
   */
  #consume = lazy(this, [this.#assertRetryQueue, this.#assertParkedQueue],
    /**
     * @param {string} queue
     * @param {comq.channels.Consumer} consumer
     * @returns {Promise<string>}
     */
    async (queue, consumer) => {
      /** @type {comq.amqp.options.Consume} */
      const options = {}

      if (this.#topology.acknowledgments) consumer = this.#getAcknowledgingConsumer(queue, consumer)
      else options.noAck = true

      const response = await this.#channel.consume(queue, consumer, options)

      this.#tags.push(response.consumerTag)

      return response.consumerTag
    })

  /**
   * @param {string} queue the queue being consumed
   * @param {comq.channels.Consumer} consumer
   * @returns {comq.channels.Consumer}
   */
  #getAcknowledgingConsumer = (queue, consumer) =>
    async (message) => {
      try {
        await consumer(message)

        this.#channel.ack(message)
      } catch (exception) {
        if (exception?.message === 'Channel closed') { return } // the message is requeued by the broker

        await this.#failed(queue, message, exception)
      }
    }

  /**
   * A message its consumer could not handle is delayed and given another attempt, and
   * kept once it has had enough of them.
   *
   * Nothing here may reject. amqplib dispatches a delivery through an event emitter and
   * drops the promise it gets back, so a rejection has nobody to catch it and ends the
   * process. What cannot be carried out is handed back to the broker instead.
   *
   * @param {string} queue
   * @param {comq.amqp.Message} message
   * @param {Error} exception
   */
  async #failed (queue, message, exception) {
    try {
      // the header is which attempt this delivery is, and the first does not carry one
      const attempt = message.properties.headers?.[ATTEMPT_HEADER] ?? 1

      // one rung per retry: a message that has climbed the ladder has nowhere left to wait
      if (attempt > this.#delays.length) await this.#park(queue, message, exception)
      else await this.#retry(queue, message, attempt, exception)
    } catch {
      // the message could not be moved: give the delivery back rather than lose it
      this.#return(message)
    }
  }

  /**
   * @param {string} queue
   * @param {comq.amqp.Message} message
   * @param {number} attempt
   * @param {Error} exception
   */
  async #retry (queue, message, attempt, exception) {
    const properties = this.#carry(message, { [ATTEMPT_HEADER]: attempt + 1 })

    // the copy is placed before the original is released: a message the broker holds
    // twice can be recovered, one it no longer holds at all cannot
    await this.#publish(this.#retryQueueOf(attempt), queue, message.content, properties)

    this.#channel.ack(message)

    // the attempt that just failed, rather than the one it is about to get
    this.#diagnostics.emit('retry', message, exception, attempt)
  }

  /**
   * @param {string} queue
   * @param {comq.amqp.Message} message
   * @param {Error} [exception]
   */
  async #park (queue, message, exception) {
    const properties = this.#carry(message, {
      [PARKED_QUEUE_HEADER]: queue,
      [PARKED_REASON_HEADER]: exception?.message,
      [PARKED_AT_HEADER]: Date.now()
    })

    await this.#publish(DEFAULT, parkedQueueOf(queue), message.content, properties)

    this.#channel.ack(message)

    this.#diagnostics.emit('discard', message, exception)
  }

  /**
   * The properties a copy of a failed message is published with.
   *
   * The exchange and routing key are recorded on the first failure and carried from
   * then on: a message that has been through the retry queue comes back through the
   * default exchange, so by the time it is parked its own fields describe that hop
   * rather than where it was published.
   *
   * It is published persistent whatever the channel is: Requests are transient for the
   * sake of latency, and the path a failed message takes is not the one latency is on.
   *
   * @param {comq.amqp.Message} message
   * @param {object} added
   * @returns {comq.amqp.options.Publish}
   */
  #carry (message, added) {
    const headers = {
      [ORIGIN_EXCHANGE_HEADER]: message.fields?.exchange,
      [ORIGIN_KEY_HEADER]: message.fields?.routingKey,
      ...message.properties.headers,
      ...added
    }

    return { ...message.properties, headers, persistent: true, mandatory: true }
  }

  /**
   * @param {comq.amqp.Message} message
   */
  #return (message) {
    // a channel that is already gone requeues what it held anyway
    try { this.#channel.nack(message, false, true) } catch { /* nothing left to do with it */ }
  }

  #pause () {
    if (this.#paused !== null) return

    this.#paused = new Promex()
    this.#diagnostics.emit('flow')
    this.#diagnostics.emit('pause')
  }

  /**
   * @param {Error} [exception]
   */
  #unpause = (exception) => {
    if (this.#paused === null) return

    if (exception === undefined) this.#paused.resolve()
    else this.#paused.reject(exception)

    this.#paused = null
    this.#diagnostics.emit('drain')
    this.#diagnostics.emit('resume')
  }

  async #unpaused () {
    if (this.#failfast) throw INTERRUPTION // tell shards.Channel to remove this one from the pool
    else await this.#paused
  }

  async #recover (exception) {
    if (permanent(exception)) return false
    if (this.#recovering) return false
    else await this.#recovery
  }
}

/**
 * @param {comq.amqp.Connection} connection
 * @param {comq.Topology} topology
 * @param {number} [index]
 * @param {(channel: comq.Channel) => void} [release]
 * @return {Promise<comq.Channel>}
 */
async function create (connection, topology, index, release) {
  const channel = new Channel(connection, topology, index, release)

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

const RETRY_PREFIX = 'comq.retry.'
const PARKED_PREFIX = 'comq.parked.'

const parkedQueueOf = (queue) => PARKED_PREFIX + queue

// Everything comq writes onto a message, under its own prefix: AMQP defines no retry
// counter, so this one is comq's invention rather than a convention, and an unprefixed
// name would be free to collide with the application's own headers or another library's.
//
// What a person looking at a parked message needs, and nothing else. The broker's own
// `x-death` is no substitute: it names the retry queue rather than where the message
// came from, and its `count` is a second counter that agrees with this one until it
// does not.
const ATTEMPT_HEADER = 'x-comq-attempt'
const ORIGIN_EXCHANGE_HEADER = 'x-comq-exchange'
const ORIGIN_KEY_HEADER = 'x-comq-key'
const PARKED_QUEUE_HEADER = 'x-comq-queue'
const PARKED_REASON_HEADER = 'x-comq-reason'
const PARKED_AT_HEADER = 'x-comq-at'

function noop () {}

exports.create = create
