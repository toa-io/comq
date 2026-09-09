'use strict'

const stream = require('node:stream')
const { setTimeout } = require('node:timers/promises')
const { Promex } = require('promex')
const { memo, failsafe, lazy, track } = require('./attributes')
const { verdictOf, PARK } = require('./verdicts')

const { decode } = require('./decode')
const { encode } = require('./encode')
const { pipeline, transform } = require('./pipeline')
const events = require('./events')
const emitter = require('./emitter')
const io = require('./.io')

/**
 * @implements {comq.IO}
 */
class IO {
  /** @type {comq.Connection} */
  #connection

  /** @type {comq.Channel} */
  #requests

  /** @type {comq.Channel} */
  #replies

  /** @type {comq.Channel} */
  #events

  /** @type {Map<string, comq.ReplyEmitter>} */
  #emitters = new Map()

  /** @type {comq.ReplyEmitter | null} */
  #control = null

  /** @type {Map<Promex, comq.Request>} */
  #pendingReplies = new Map()

  /** @type {[comq.diagnostics.Event, Function][]} */
  #forwarders = []

  /** @type {Set<comq.Destroyable>} */
  #replyStreams = new Set()

  /** @type {Set<comq.Destroyable>} */
  #replyPipes = new Set()

  #diagnostics = emitter.create()

  /**
   * @param {comq.Connection} connection
   */
  constructor (connection) {
    this.#connection = connection

    for (const event of events.connection) {
      const forwarder = (...args) => this.#diagnostics.emit(event, ...args)

      this.#connection.diagnose(event, forwarder)
      this.#forwarders.push([event, forwarder])
    }
  }

  reply = lazy(this, this.#createRequestReplyChannels,
    /**
     * @param {string} queue
     * @param {comq.Producer} callback
     * @returns {Promise<void>}
     */
    async (queue, callback) => {
      const consumer = this.#getRequestConsumer(callback)

      await this.#requests.consume(queue, consumer)
    })

  // failsafe is aimed to retransmit unanswered messages
  request = lazy(this, [this.#createRequestReplyChannels, this.#consumeReplies],
    failsafe(this, this.#recover,
      /**
       * @param {string} queue
       * @param {any | Readable} payload
       * @param {comq.Encoding} [encoding]
       * @returns {Promise<any | Readable>}
       */
      async (queue, payload, encoding) => {
        if (payload instanceof stream.Readable) {
          return pipeline(
            payload,
            (payload) => this.request(queue, payload, encoding),
            this.#requests
          )
        }

        const [buffer, contentType] = this.#encode(payload, encoding)
        const request = this.#createRequest(queue, contentType)
        const reply = this.#createReply(request)

        await this.#requests.send(queue, buffer, request.properties)

        return reply
      }))

  consume = lazy(this, this.#createEventChannel,
    async (exchange, group, callback) => {
      if (callback === undefined) { // two arguments passed
        callback = group
        group = undefined
      }

      const exclusive = group === undefined
      const queue = exclusive ? undefined : io.concat(exchange, group)
      const consumer = this.#getEventConsumer(callback)

      await this.#events.subscribe(exchange, queue, consumer)
    })

  emit = lazy(this, this.#createEventChannel,
    /**
     * @param {string} exchange
     * @param {any} payload
     * @param {comq.Encoding | comq.amqp.options.Publish} [encoding]
     * @param {'publish' | 'send'} method
     * @returns {Promise<void>}
     */
    async (exchange, payload, encoding, method = 'publish') => {
      if (payload instanceof stream.Readable) {
        return transform(
          payload,
          (payload) => this.emit(exchange, payload, encoding, method),
          this.#events
        )
      }

      const [buffer, properties] = this.#properties(payload, encoding)

      await this.#events[method](exchange, buffer, properties)
    })

  /**
   * Publishes to a routed exchange under a key, where `emit` fans out. The exchange is
   * `direct`, so a message reaches the queues bound under that key and no others.
   */
  route = lazy(this, this.#createEventChannel,
    /**
     * @param {string} exchange
     * @param {string} key
     * @param {any} payload
     * @param {comq.Encoding | comq.amqp.options.Publish} [encoding]
     * @returns {Promise<void>}
     */
    async (exchange, key, payload, encoding) => {
      const [buffer, properties] = this.#properties(payload, encoding)

      await this.#events.route(exchange, key, buffer, properties)
    })

  /**
   * Consumes a named durable queue bound to a routed exchange under a key, where `consume`
   * takes everything published to a fanout. The queue is named rather than derived, because
   * what is bound to it is a key rather than an exchange.
   */
  subscribe = lazy(this, this.#createEventChannel,
    /**
     * @param {string} exchange
     * @param {string} queue
     * @param {string} key
     * @param {comq.Consumer} callback
     * @returns {Promise<void>}
     */
    async (exchange, queue, key, callback) => {
      const consumer = this.#getEventConsumer(callback)

      await this.#events.bound(exchange, queue, key, consumer)
    })

  process = lazy(this, this.#createEventChannel,
    async (queue, callback) => {
      const consumer = this.#getEventConsumer(callback)

      await this.#events.consume(queue, consumer)
    })

  enqueue (queue, payload, encoding) {
    return this.emit(queue, payload, encoding, 'send')
  }

  seal = memo(async () => {
    await this.#requests?.seal()
    await this.#events?.seal()
    await this.#destroyStreams(this.#replyStreams)
  })

  close = memo(async () => {
    await this.seal()
    await this.#destroyStreams(this.#replyPipes)
    await track(this)

    // a connection is shared and outlives its IOs, so the channels are given back
    // here — held to the end of the connection, they would run it out of them
    await Promise.all([this.#requests, this.#replies, this.#events]
      .map((channel) => channel?.close()))

    // a connection that outlives its IO must not keep it as a listener
    for (const [event, forwarder] of this.#forwarders) this.#connection.forget(event, forwarder)

    this.#forwarders = []

    await this.#connection.close()
  })

  diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  // region initializers

  async #createRequestReplyChannels () {
    this.#requests = await this.#createChannel('request')
    this.#replies = await this.#createChannel('reply')

    this.#setupRetransmission()
  }

  async #createEventChannel () {
    this.#events = await this.#createChannel('event')
  }

  /**
   * What a publication carries, from what its caller passed as an encoding or as properties.
   *
   * @param {any} payload
   * @param {comq.Encoding | comq.amqp.options.Publish} [encoding]
   * @returns {[Buffer, comq.amqp.options.Publish]}
   */
  #properties (payload, encoding) {
    /** @type {comq.amqp.options.Publish} */
    const properties = {}

    if (typeof encoding === 'object') { // properties passed
      Object.assign(properties, encoding)

      encoding = /** @type {comq.Encoding} */ properties.contentType
    }

    const [buffer, contentType] = this.#encode(payload, encoding)

    properties.contentType = contentType

    return [buffer, properties]
  }

  async #consumeReplies (queue) {
    const emitter = io.createReplyEmitter(queue)
    const consumer = this.#getReplyConsumer(queue, emitter)

    this.#emitters.set(queue, emitter)

    await this.#replies.consume(emitter.queue, consumer)
  }

  // endregion

  /**
   * @param {comq.topology.type} type
   * @returns {Promise<comq.Channel>}
   */
  async #createChannel (type) {
    const channel = await this.#connection.createChannel(type)

    for (const event of events.channel) {
      channel.diagnose(event, (...args) => this.#diagnostics.emit(event, type, ...args))
    }

    return channel
  }

  #setupRetransmission () {
    if (this.#requests.sharded === true) {
      // a shard leaves the pool when it rejects a publish, and is lost when its
      // connection drops, which leaves an already sent request unanswered
      this.#requests.diagnose('remove', this.#retransmit)
      this.#requests.diagnose('lost', this.#retransmit)
    } else {
      this.#requests.diagnose('recover', this.#retransmit)
    }

    // a reply that could not be routed is dropped by the broker, and the queue
    // it was addressed to only exists again once this channel has recovered
    this.#replies.diagnose('recover', this.#retransmit)
  }

  /**
   * @param {comq.Producer} producer
   * @returns {comq.channels.Consumer}
   */
  #getRequestConsumer = (producer) =>
    track(this,
      /**
       * @param {comq.amqp.Message} request
       * @returns {Promise<void>}
       */
      async (request) => {
        const payload = decode(request)
        const reply = await produce(producer, payload)

        if (request.properties.replyTo === undefined) return

        const iterator = typeof reply === 'object' && reply !== null &&
          (Symbol.asyncIterator in reply ||
            (Symbol.iterator in reply && !Array.isArray(reply) && !Buffer.isBuffer(reply)))

        if (iterator) {
          const readable = reply instanceof stream.Readable
            ? reply
            : stream.Readable.from(reply)

          this.#control ??= await this.#createControl()

          const pipe = await io.ReplyPipe.create(request, readable, this.#replies, this.#control,
            (message, properties) => this.#reply(request, message, properties))

          this.#addReplyPipe(pipe)
        } else {
          await this.#reply(request, reply)
        }
      })

  /**
   * @param {string} queue
   * @param {comq.ReplyEmitter} emitter
   * @returns {comq.channels.Consumer}
   */
  #getReplyConsumer = (queue, emitter) =>
    (message) => {
      const payload = decode(message)

      emitter.emit(message.properties.correlationId, payload, message.properties, message.content.length)
    }

  /**
   * @param {comq.Consumer} callback
   * @returns {comq.channels.Consumer}
   */
  #getEventConsumer = (callback) =>
    track(this, async (message) => {
      const payload = decode(message)

      await callback(payload, message.properties)
    })

  /**
   * The request holds no copy of what was sent: a retransmission encodes the
   * payload anew, and an unanswered request would otherwise keep two of it.
   *
   * @param {string} queue
   * @param {comq.Encoding} contentType
   * @return {comq.Request}
   */
  #createRequest (queue, contentType) {
    const emitter = this.#emitters.get(queue)
    const correlationId = emitter.next()

    /** @type {comq.amqp.Properties} */
    const properties = { contentType, correlationId, replyTo: emitter.queue }

    return { emitter, properties }
  }

  /**
   * @param {comq.Request} request
   * @return {Promex<any>}
   */
  #createReply (request) {
    const reply = this.#createPendingReply(request)

    request.emitter.on(request.properties.correlationId, this.#getReplyResolver(request, reply))

    return reply
  }

  /**
   * @param {comq.Request} request
   * @return {Promex}
   */
  #createPendingReply (request) {
    const reply = new Promex()
    const settled = () => this.#pendingReplies.delete(reply)

    this.#pendingReplies.set(reply, request)

    // one derived promise per request, and a rejection handled with it
    reply.then(settled, settled)

    return reply
  }

  /**
   * @param {comq.Request} request
   * @param reply
   */
  #getReplyResolver (request, reply) {
    return async (payload, properties, size) => {
      const isStream = properties.headers?.index !== undefined

      // a reply is answered once; a reply stream takes the place of this resolver
      request.emitter.off(request.properties.correlationId)

      if (isStream) {
        const stream = this.#createReplyStream(request, payload, properties, size)

        try {
          await stream.confirmation
        } catch {
          // the stream has never started, hence the request is re-sent
          return reply.reject(RETRANSMISSION)
        }

        reply.resolve(stream)
      } else {
        reply.resolve(payload)
      }
    }
  }

  #createReplyStream (request, payload, properties, size) {
    const stream = new io.ReplyStream(request, this.#reply.bind(this))

    stream.arrange(payload, properties, size)
    this.#addReplyStream(/** @type {comq.Destroyable} */ stream)

    return stream
  }

  /**
   * @return {Promise<comq.ReplyEmitter>}
   */
  async #createControl () {
    const queue = 'control'

    await this.#consumeReplies(queue)

    return this.#emitters.get(queue)
  }

  /**
   * @param {comq.Destroyable} stream
   */
  #addReplyStream (stream) {
    this.#addStream(stream, this.#replyStreams)
  }

  /**
   * @param {comq.Destroyable} pipe
   */
  #addReplyPipe (pipe) {
    this.#addStream(pipe, this.#replyPipes)
  }

  /**
   * @param {comq.Destroyable} stream
   * @param {Set<comq.Destroyable>} streams
   */
  #addStream (stream, streams) {
    streams.add(stream)
    stream.on('close', () => streams.delete(stream))
  }

  /**
   * @param {Set<comq.Destroyable>} streams
   * @return {Promise<void>}
   */
  async #destroyStreams (streams) {
    if (streams.size === 0) return

    for (const stream of streams) stream.destroy()

    /*
    When streams are destroyed, they attempt to send an 'end' control message.
    Since these messages are sent without an acknowledgment,
    it is needed to wait briefly before closing the connection.
    Even if these messages are lost, the reply stream will be closed anyway,
    either due to missing heartbeat or the deletion of the stream queue.
    */
    await setTimeout(50)
  }

  /**
   * @param {Pick<comq.amqp.Message, 'properties'>} request
   * @param {any} reply
   * @param {comq.amqp.options.Publish} [properties]
   * @returns {Promise<boolean>}
   */
  async #reply (request, reply, properties = {}) {
    if (reply === undefined) throw new Error('The `producer` function must return a value')

    let { replyTo, contentType } = request.properties

    if (Buffer.isBuffer(reply)) contentType = OCTETS
    if (contentType === undefined) throw new Error('Reply to a Request without the `contentType` property must be of type `Buffer`')

    const buffer = contentType === OCTETS ? reply : encode(reply, contentType)

    properties.contentType = contentType
    properties.correlationId = request.properties.correlationId

    // an unroutable reply must be returned by the broker rather than dropped
    properties.mandatory = true

    return await this.#replies.fire(replyTo, buffer, properties)
  }

  #recover (exception) {
    if (exception !== RETRANSMISSION) return false
  }

  #retransmit = () => {
    for (const [reply, request] of this.#pendingReplies) {
      // detaching this attempt alone leaves the listeners of the reply streams
      // that are still flowing over the other shards in place
      request.emitter.off(request.properties.correlationId)

      // trigger failsafe attribute
      reply.reject(RETRANSMISSION)
    }
  }

  /**
   * @param {any} payload
   * @param {comq.Encoding} [contentType]
   * @returns {[Buffer, comq.Encoding]}
   */
  #encode (payload, contentType) {
    const raw = Buffer.isBuffer(payload)

    contentType ??= raw ? OCTETS : DEFAULT

    const buffer = raw ? payload : encode(payload, contentType)

    return [buffer, contentType]
  }
}

/** @type {comq.Encoding} */
const OCTETS = 'application/octet-stream'

/** @type {comq.Encoding} */
const DEFAULT = 'application/json'

const RETRANSMISSION = /** @type {Error} */ Symbol('retransmission')

/**
 * A verdict answers what should happen to a message now that it has failed and nobody
 * is waiting for it. A Producer has a caller waiting, and what it is owed is a reply,
 * so `Park` is a category error there rather than a policy choice — comq's own type
 * vocabulary already draws the line between a Consumer and a Producer.
 *
 * It cannot be caught at wiring time, since nothing there knows what a producer will
 * throw. Caught here instead and re-thrown as an ordinary rejection, which retries and
 * eventually parks, carrying an explanation the parked message keeps as its reason.
 *
 * @param {comq.Producer} producer
 * @param {any} payload
 */
async function produce (producer, payload) {
  try {
    return await producer(payload)
  } catch (exception) {
    if (verdictOf(exception) !== PARK) throw exception

    throw new Error('Park is not applicable to a reply producer: a Request has a caller ' +
      'awaiting a reply, so it is retried and parked on the count like any other failure',
    { cause: exception })
  }
}

exports.IO = IO
