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

  _read (_) {}

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
 * @param {comq.amqp.Message} request
 * @param {stream.Readable} stream
 * @param {comq.Channel} channel
 * @param {(message: any, properties?: comq.amqp.Properties) => Promise<void>} send
 * @return {Promise<void>}
 */
async function pipe (request, stream, channel, send) {
  let stop = false

  channel.diagnose('return', (message) => {
    if (message.fields.routingKey === request.properties.replyTo)
      stop = true
  })

  await send(control.ok, properties.control)

  for await (const chunk of stream) {
    await send(chunk, properties.chunk)

    if (stop) stream.destroy()
  }

  await send(control.end, properties.control)
}

const streamCorrelationId = 'chunk'
const streamControlCorrelationId = 'control'

const control = {
  ok: 'ok',
  heartbeat: 'heartbeat',
  end: 'end'
}

/** @type {Record<string, comq.amqp.options.Publish>} */
const properties = {
  chunk: { correlationId: streamCorrelationId, mandatory: true },
  control: { correlationId: streamControlCorrelationId, mandatory: true }
}

exports.createReplyEmitter = createReplyEmitter
exports.ReplyStream = ReplyStream
exports.pipe = pipe
