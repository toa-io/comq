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

  #control

  #reply

  #idleInterval

  #index = 0

  #buffered = 0

  /** @type {Record<number, unknown>} */
  #queue = {}

  /**
   * @param {comq.Request} request
   * @param {any} reply
   */
  constructor (request, reply) {
    super({ objectMode: true })

    this.#confirmation = request.reply
    this.#emitter = request.emitter
    this.#correlationId = request.properties.correlationId
    this.#idleInterval = global['COMQ_TESTING_IDLE_INTERVAL'] || IDLE_INTERVAL
    this.#reply = reply

    this.#emitter.on(this.#correlationId, this._arrange.bind(this))
    this.#confirmation.catch(this._clear.bind(this))
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
  _arrange (payload, properties) {
    if (properties.headers.index !== this.#index) {
      this._enqueue(payload, properties)

      return
    }

    this._add(payload, properties)

    if (this.#buffered > 0) {
      let message

      while ((message = this.#queue[this.#index])) {
        delete this.#queue[this.#index]
        this._add(message.payload, message.properties)
      }

      this.#buffered = Object.keys(this.#queue).length
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
    else
      this.push(payload)
  }

  _enqueue (payload, properties) {
    if (this.#buffered > MAX_BUFFER_SIZE) this.destroy()

    this.#buffered++
    this.#queue[properties.headers.index] = { payload, properties }
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

    try {
      void this.#reply(this.#control, control.end)
    } catch {
      console.log('close error')
    }
  }
}

const MAX_BUFFER_SIZE = 1000

exports.Stream = Stream
