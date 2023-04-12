'use strict'

const { EventEmitter } = require('node:events')
const { randomBytes } = require('node:crypto')
const { lazy, track, failsafe, promex } = require('@toa.io/generic')

const { decode } = require('./decode')
const { encode } = require('./encode')
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

  /** @type {Set<toa.generic.Promex>} */
  #pendingReplies = new Set()

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
     * @param {comq.producer} callback
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
       * @param {any} payload
       * @param {comq.encoding} [encoding]
       * @param {comq.ReplyToPropertyFormatter} [replyToFormatter]
       * @returns {Promise<void>}
       */
      async (queue, payload, encoding, replyToFormatter) => {
        const [buffer, contentType] = this.#encode(payload, encoding)
        const emitter = this.#emitters.get(queue)
        const reply = this.#createReply()
        const correlationId = randomBytes(8).toString('hex')
        const properties = { contentType, correlationId }

        properties.replyTo = replyToFormatter?.(emitter.queue) ?? emitter.queue

        emitter.once(correlationId, reply.resolve)

        await this.#requests.send(queue, buffer, properties)

        return reply
      }))

  consume = lazy(this, this.#createEventChannel,
    async (exchange, group, callback) => {
      if (callback === undefined) { // 2 arguments passed
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
     * @param {comq.encoding | comq.amqp.options.Publish} [encoding]
     * @returns {Promise<void>}
     */
    async (exchange, payload, encoding) => {
      /** @type {comq.amqp.options.Publish} */
      const properties = {}

      if (typeof encoding !== 'string') { // properties passed
        Object.assign(properties, encoding)

        encoding = /** @type {comq.encoding} */ properties.contentType
      }

      const [buffer, contentType] = this.#encode(payload, encoding)

      properties.contentType = contentType

      await this.#events.publish(exchange, buffer, properties)
    })

  async seal () {
    await this.#requests?.seal()
    await this.#events?.seal()
  }

  async close () {
    await this.seal()
    await track(this)
    await this.#connection.close()
  }

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
   * @param {comq.producer} producer
   * @returns {comq.channels.consumer}
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

        if ('replyTo' in request.properties) await this.#reply(request, reply)
      })

  /**
   * @param {comq.amqp.Message} request
   * @param {any} reply
   * @returns {Promise<void>}
   */
  async #reply (request, reply) {
    if (reply === undefined) throw new Error('The `producer` function must return a value')

    let { replyTo, correlationId, contentType } = request.properties

    if (Buffer.isBuffer(reply)) contentType = OCTETS
    if (contentType === undefined) throw new Error('Reply to a Request without the `contentType` property must be of type `Buffer`')

    const buffer = contentType === OCTETS ? reply : encode(reply, contentType)
    const properties = { contentType, correlationId }

    await this.#replies.fire(replyTo, buffer, properties)
  }

  /**
   * @param {string} queue
   * @param {comq.ReplyEmitter} emitter
   * @returns {comq.channels.consumer}
   */
  #getReplyConsumer = (queue, emitter) =>
    (message) => {
      const payload = decode(message)

      emitter.emit(message.properties.correlationId, payload)
    }

  /**
   * @param {comq.consumer} callback
   * @returns {comq.channels.consumer}
   */
  #getEventConsumer = (callback) =>
    track(this, async (message) => {
      const payload = decode(message)

      await callback(payload)
    })

  /**
   * @return {toa.generic.Promex}
   */
  #createReply () {
    const reply = promex()

    this.#pendingReplies.add(reply)

    reply
      .catch(noop)
      .finally(() => this.#pendingReplies.delete(reply))

    return reply
  }

  #recover (exception) {
    if (exception !== RETRANSMISSION) return false
  }

  #retransmit = () => {
    for (const emitter of this.#emitters.values()) emitter.clear()

    // trigger failsafe attribute
    for (const reply of this.#pendingReplies) reply.reject(RETRANSMISSION)
  }

  /**
   * @param {any} payload
   * @param {comq.encoding} [contentType]
   * @returns [Buffer, comq.encoding]
   */
  #encode (payload, contentType) {
    const raw = Buffer.isBuffer(payload)

    contentType ??= raw ? OCTETS : DEFAULT

    const buffer = raw ? payload : encode(payload, contentType)

    return [buffer, contentType]
  }
}

/** @type {comq.encoding} */
const OCTETS = 'application/octet-stream'

/** @type {comq.encoding} */
const DEFAULT = 'application/msgpack'

const RETRANSMISSION = /** @type {Error} */ Symbol('retransmission')

function noop () {}

exports.IO = IO
