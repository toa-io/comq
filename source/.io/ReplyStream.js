'use strict'

const { Readable } = require('node:stream')
const { promex } = require('@toa.io/generic')
const { IDLE_INTERVAL, control } = require('./const')

class ReplyStream extends Readable {
  confirmation = promex()

  /** @type {ReturnType<setTimeout> | null} */
  #timeout = null

  /** @type {comq.ReplyEmitter} */
  #emitter

  /** @type {string} */
  #correlationId

  #control

  #reply

  #idleInterval

  #index = 0

  #buffered = 0

  /** @type {Map<number, unknown>} */
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
    this.#reply = reply

    this.#emitter.on(this.#correlationId, this.arrange.bind(this))
  }

  _destroy (error, callback) {
    this._clear()
    this.push(null)

    void this.#reply(this.#control, control.end)
    super._destroy(error, callback)
  }

  _read (_) {}

  /**
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   */
  arrange (payload, properties) {
    if (properties.headers.index !== this.#index) {
      this._buffer(payload, properties)

      return
    }

    this._add(payload, properties)

    if (this.#buffered > 0) {
      let message

      while ((message = this.#queue.get(this.#index))) {
        this.#queue.delete(this.#index)
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
      this._clear()
  }

  _buffer (payload, properties) {
    if (this.#buffered > MAX_BUFFER_SIZE) this.destroy()

    this.#buffered++
    this.#queue.set(properties.headers.index, { payload, properties })
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
    this.#emitter.removeAllListeners(this.#correlationId)
  }
}

const MAX_BUFFER_SIZE = 1000

exports.ReplyStream = ReplyStream
