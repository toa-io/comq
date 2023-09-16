'use strict'

const { randomBytes } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')

const { concat } = require('./concat')

/**
 * @param {string} label
 * @returns {comq.ReplyEmitter}
 */
function createReplyEmitter (label) {
  const id = randomBytes(8).toString('hex')
  const queue = concat(label, id)
  const emitter = new EventEmitter()
  const once = (event, callback) => emitter.once(event, callback)
  const on = (event, callback) => emitter.on(event, callback)
  const emit = (event, value) => emitter.emit(event, value)
  const clear = () => emitter.removeAllListeners()

  emitter.setMaxListeners(0)

  return { queue, on, once, emit, clear }
}

class ReplyStream extends Readable {
  #confirmation

  /** @type {comq.ReplyEmitter} */
  #emitter

  /**
   * @param {comq.ReplyEmitter} emitter
   * @param confirmation
   */
  constructor (emitter, confirmation) {
    super({ objectMode: true })

    this.#confirmation = confirmation
    this.#emitter = emitter

    emitter.on(streamCorrelationId, (value) => this.push(value))
    emitter.on('control', (message) => this._control(message))
  }

  _destroy (error, callback) {
    this.#emitter.clear()

    super._destroy(error, callback)
  }

  _control (message) {
    switch (message) {
      case control.ok:
        this.#confirmation.resolve()
        break
      case control.end:
        this.push(null)
        break
      default:
        throw new Error(`Unknown stream control message: '${message}'`)
    }
  }
}

/**
 * @param {stream.Readable} stream
 * @param {(message: any, properties?: comq.amqp.Properties) => Promise<void>} send
 * @return {Promise<void>}
 */
async function pipe (stream, send) {
  await send(control.ok, { correlationId: streamControlCorrelationId })

  for await (const chunk of stream) {
    await send(chunk, { correlationId: streamCorrelationId })
  }

  await send(control.end, { correlationId: streamControlCorrelationId })
}

const streamCorrelationId = 'chunk'
const streamControlCorrelationId = 'control'

const control = {
  ok: 'ok',
  heartbeat: 'heartbeat',
  end: 'end'
}

exports.createReplyEmitter = createReplyEmitter
exports.ReplyStream = ReplyStream
exports.pipe = pipe
exports.streamCorrelationId = streamCorrelationId
exports.streamControlCorrelationId = streamControlCorrelationId
