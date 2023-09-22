'use strict'

const { IDLE_INTERVAL, control } = require('./const')

const { Readable } = require('node:stream')

class Stream extends Readable {
  #confirmation

  /** @type {ReturnType<setTimeout> | null} */
  #timeout = null

  /** @type {comq.ReplyEmitter} */
  #emitter

  /** @type {string} */
  #correlationId

  #idleInterval

  #index = 0

  #buffering = false

  /** @type {Record<number, unknown>} */
  #queue = {}

  /**
   * @param {comq.ReplyEmitter} emitter
   * @param {string} correlationId
   * @param confirmation
   */
  constructor (emitter, correlationId, confirmation) {
    super({ objectMode: true })

    this.#confirmation = confirmation
    this.#emitter = emitter
    this.#correlationId = correlationId
    this.#idleInterval = global['COMQ_TESTING_IDLE_INTERVAL'] || IDLE_INTERVAL

    emitter.on(correlationId, this._accept.bind(this))
  }

  _destroy (error, callback) {
    this._clear()
    this.push(null)

    super._destroy(error, callback)
  }

  _read (_) {}

  /**
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   * @private
   */
  _accept (payload, properties) {
    this._heartbeat()

    if (properties.headers.index !== this.#index) {
      this._enqueue(payload, properties)

      return
    }

    this._add(payload, properties)

    if (this.#buffering) {
      let message

      while ((message = this.#queue[this.#index])) {
        delete this.#queue[this.#index]
        this._add(message.payload, message.properties)
      }

      this.#buffering = Object.keys(this.#queue).length > 0
    }
  }

  /**
   * @param {unknown} payload
   * @param {comq.amqp.Properties} properties
   * @private
   */
  _add (payload, properties) {
    this.#index++

    if (properties.type === 'control')
      this._control(payload)
    else
      this.push(payload)
  }

  _enqueue (payload, properties) {
    this.#buffering = true
    this.#queue[properties.headers.index] = { payload, properties }
  }

  _control (message) {
    switch (message) {
      case control.ok:
        this.#confirmation.resolve()
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

exports.Stream = Stream
