'use strict'

const stream = require('node:stream')
const { EventEmitter } = require('node:events')
const { randomBytes } = require('node:crypto')
const { setTimeout } = require('node:timers/promises')
const { Promex } = require('promex')
const { memo, failsafe, lazy, track } = require('./attributes')

const { decode } = require('./decode')
const { encode } = require('./encode')
const { pipeline, transform } = require('./pipeline')
const events = require('./events')
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

  /** @type {Set<Promex>} */
  #pendingReplies = new Set()

  /** @type {Set<comq.Destroyable>} */
  #replyStreams = new Set()

  /** @type {Set<comq.Destroyable>} */
  #replyPipes = new Set()

  #diagnostics = new EventEmitter()

  /**
   * @param {comq.Connection} connection
   */
  constructor (connection) {
    this.#connection = connection

    for (const event of events.connection) {
      this.#connection.diagnose(event, (...args) => this.#diagnostics.emit(event, ...args))
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

        const request = this.#createRequest(queue, payload, encoding)
        const reply = this.#createReply(request)

        await this.#requests.send(queue, request.buffer, request.properties)

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
     * @returns {Promise<void>}
     */
    async (exchange, payload, encoding) => {
      if (payload instanceof stream.Readable) {
        return transform(
          payload,
          (payload) => this.emit(exchange, payload, encoding),
          this.#events
        )
      }

      /** @type {comq.amqp.options.Publish} */
      const properties = {}

      if (typeof encoding === 'object') { // properties passed
        Object.assign(properties, encoding)

        encoding = /** @type {comq.Encoding} */ properties.contentType
      }

      const [buffer, contentType] = this.#encode(payload, encoding)

      properties.contentType = contentType

      await this.#events.publish(exchange, buffer, properties)
    })

  seal = memo(async () => {
    await this.#requests?.seal()
    await this.#events?.seal()
    await this.#destroyStreams(this.#replyStreams)
  })

  close = memo(async () => {
    await this.seal()
    await this.#destroyStreams(this.#replyPipes)
    await track(this)
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
    const event = (this.#requests.sharded === true) ? 'remove' : 'recover'

    this.#requests.diagnose(event, this.#retransmit)
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
        const reply = await producer(payload)

        if (request.properties.replyTo === undefined) return

        const iterator = typeof reply === 'object' &&
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

      emitter.emit(message.properties.correlationId, payload, message.properties)
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
   * @param {string} queue
   * @param {any} payload
   * @param {comq.Encoding} [encoding]
   * @return {comq.Request}
   */
  #createRequest (queue, payload, encoding) {
    const [buffer, contentType] = this.#encode(payload, encoding)
    const emitter = this.#emitters.get(queue)
    const correlationId = randomBytes(8).toString('hex')

    /** @type {comq.amqp.Properties} */
    const properties = { contentType, correlationId, replyTo: emitter.queue }

    return { buffer, emitter, properties }
  }

  /**
   * @param {comq.Request} request
   * @return {Promex<any>}
   */
  #createReply (request) {
    const reply = this.#createPendingReply()

    request.emitter.once(request.properties.correlationId, this.#getReplyResolver(request, reply))

    return reply
  }

  /**
   * @return {Promex}
   */
  #createPendingReply () {
    const reply = new Promex()

    this.#pendingReplies.add(reply)

    reply
      .catch(noop)
      .finally(() => this.#pendingReplies.delete(reply))

    return reply
  }

  /**
   * @param {comq.Request} request
   * @param reply
   */
  #getReplyResolver (request, reply) {
    return async (payload, properties) => {
      const isStream = properties.headers?.index !== undefined

      if (isStream) {
        const stream = this.#createReplyStream(request, payload, properties)

        await stream.confirmation

        reply.resolve(stream)
      } else {
        reply.resolve(payload)
      }
    }
  }

  #createReplyStream (request, payload, properties) {
    const stream = new io.ReplyStream(request, this.#reply.bind(this))

    stream.arrange(payload, properties)
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

    return await this.#replies.fire(replyTo, buffer, properties)
  }

  #recover (exception) {
    if (exception !== RETRANSMISSION) return false
  }

  #retransmit = () => {
    for (const emitter of this.#emitters.values()) emitter.removeAllListeners()

    // trigger failsafe attribute
    for (const reply of this.#pendingReplies) reply.reject(RETRANSMISSION)
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
const DEFAULT = 'application/msgpack'

const RETRANSMISSION = /** @type {Error} */ Symbol('retransmission')

function noop () {}

exports.IO = IO
