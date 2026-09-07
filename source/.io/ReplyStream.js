'use strict'

const { Readable } = require('node:stream')
const { Promex } = require('promex')
const { IDLE_INTERVAL, FLOW_HEADER, control } = require('./const')

class ReplyStream extends Readable {
  confirmation = new Promex()

  /** @type {ReturnType<setTimeout> | null} */
  #timeout = null

  /** @type {comq.ReplyEmitter} */
  #emitter

  /** @type {string} */
  #correlationId

  /** The confirmation message, addressing the control queue of the producer. */
  #control

  #reply

  #idleInterval

  #index = 0

  #buffered = 0

  #bufferedBytes = 0

  #maxBufferSize

  #maxBufferBytes

  /** Whether the producer honours `pause` and `resume`. */
  #flow = false

  /** Whether the producer has been asked to pause. */
  #throttled = false

  /** @type {Map<number, { payload: unknown, properties: comq.amqp.Properties, size: number }>} */
  #queue = new Map()

  /**
   * @param {comq.Request} request
   * @param {any} reply
   */
  constructor (request, reply) {
    super({ objectMode: true })

    this.#emitter = request.emitter
    this.#correlationId = request.properties.correlationId
    this.#idleInterval = global['COMQ_TESTING_IDLE_INTERVAL'] || IDLE_INTERVAL
    this.#maxBufferSize = global['COMQ_TESTING_MAX_BUFFER_SIZE'] || MAX_BUFFER_SIZE
    this.#maxBufferBytes = global['COMQ_TESTING_MAX_BUFFER_BYTES'] || MAX_BUFFER_BYTES
    this.#reply = reply

    this.confirmation.catch(noop) // it is not awaited until the stream is handed over

    this.#emitter.on(this.#correlationId, this.arrange.bind(this))

    // control.ok may never arrive, hence the watchdog is armed before the first message
    this._heartbeat()
  }

  _destroy (error, callback) {
    this._clear()
    this.push(null)

    // a no-op once control.ok has been received
    this.confirmation.reject(error ?? new Error(UNCONFIRMED))

    if (this.#control !== undefined)
      void this.#reply(this.#control, control.end)

    super._destroy(error, callback)
  }

  /**
   * Called once the consumer has room again.
   */
  _read (_) {
    if (!this.#throttled) return

    this.#throttled = false

    void this.#reply(this.#control, control.resume)
  }

  /**
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   * @param {number} [size] of the encoded payload
   */
  arrange (payload, properties, size = 0) {
    if (properties.headers.index !== this.#index) {
      this._buffer(payload, properties, size)

      return
    }

    this._add(payload, properties)

    if (this.#buffered > 0) {
      let message

      while ((message = this.#queue.get(this.#index))) {
        this.#queue.delete(this.#index)
        this.#bufferedBytes -= message.size
        this._add(message.payload, message.properties)
      }

      this.#buffered = this.#queue.size
    }
  }

  /**
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   * @private
   */
  _add (payload, properties) {
    this._heartbeat()
    this.#index++

    if (properties.type === 'control')
      this._control(payload, properties)
    else if (!this.push(payload))
      this._throttle()
  }

  /**
   * Values arriving out of order are held until the gap is filled. The hold is
   * bounded by their number and, roughly, by their size: the size is that of
   * the encoded message, which is what is known of a decoded value.
   *
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   * @param {number} size
   * @private
   */
  _buffer (payload, properties, size) {
    if (this.#buffered > this.#maxBufferSize || this.#bufferedBytes + size > this.#maxBufferBytes) {
      this.destroy()

      return
    }

    this.#buffered++
    this.#bufferedBytes += size
    this.#queue.set(properties.headers.index, { payload, properties, size })
  }

  /**
   * The consumer is behind. Values in flight keep coming, and a producer that
   * knows nothing of `pause` keeps going, in which case they pile up here rather
   * than get lost: dropping the listener would leave the stream waiting for a
   * value that has already passed.
   *
   * @private
   */
  _throttle () {
    if (this.#throttled || !this.#flow) return

    this.#throttled = true

    void this.#reply(this.#control, control.pause)
  }

  /**
   * @param {string} message
   * @param {comq.amqp.Properties} properties
   * @private
   */
  _control (message, properties) {
    switch (message) {
      case control.ok:
        this.#control = { properties }
        this.#flow = properties.headers?.[FLOW_HEADER] === true
        this.confirmation.resolve()
        break
      case control.heartbeat:
        break
      case control.end:
        this.push(null)
        break
      default:
        throw new Error(`Unknown reply stream control message: '${message}'`)
    }
  }

  _heartbeat () {
    if (this.#timeout !== null) clearTimeout(this.#timeout)

    this.#timeout = setTimeout(() => this.destroy(), this.#idleInterval)
  }

  _clear () {
    clearTimeout(this.#timeout)
    this.#emitter.off(this.#correlationId)
  }
}

const MAX_BUFFER_SIZE = 1000

/** @type {number} */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024

const UNCONFIRMED = 'Reply stream has been destroyed before confirmation'

function noop () {}

exports.ReplyStream = ReplyStream
exports.UNCONFIRMED = UNCONFIRMED
