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

  /** @type {ReturnType<setTimeout> | null} */
  #timeout = null

  /** @type {comq.Channel} */
  #channel

  /** @type {comq.ReplyEmitter} */
  #emitter

  #idleInterval

  /**
   * @param {comq.ReplyEmitter} emitter
   * @param confirmation
   * @param {comq.Channel} channel
   */
  constructor (emitter, confirmation, channel) {
    super({ objectMode: true })

    this.#confirmation = confirmation
    this.#emitter = emitter
    this.#channel = channel

    this.#idleInterval = global['COMQ_TESTING_IDLE_INTERVAL'] || IDLE_INTERVAL

    emitter.on(streamCorrelationId, (value) => this._chunk(value))
    emitter.on('control', (message) => this._control(message))
  }

  async _destroy (error, callback) {
    clearTimeout(this.#timeout)

    this.#emitter.clear()
    this.push(null)

    await this.#channel.cancel(this.#emitter.tag)

    super._destroy(error, callback)
  }

  _read (_) {}

  _chunk (chunk) {
    this.push(chunk)
    this._heartbeat()
  }

  _control (message) {
    switch (message) {
      case control.ok:
        this.#confirmation.resolve()
        this._heartbeat()
        break
      case control.heartbeat:
        this._heartbeat()
        break
      case control.end:
        this.push(null)
        break
      default:
        throw new Error(`Unknown stream control message: '${message}'`)
    }
  }

  _heartbeat () {
    if (this.#timeout !== null) clearTimeout(this.#timeout)

    this.#timeout = setTimeout(() => this.destroy(), this.#idleInterval)
  }
}

/**
 * @param {comq.amqp.Message} request
 * @param {stream.Readable} stream
 * @param {comq.Channel} channel
 * @param {(message: any, properties?: comq.amqp.options.Publish) => Promise<void>} send
 * @return {Promise<void>}
 */
async function pipe (request, stream, channel, send) {
  let interrupt = false

  const heartbeatInterval = global['COMQ_TESTING_HEARTBEAT_INTERVAL'] || HEARTBEAT_INTERVAL

  channel.diagnose('return', (message) => {
    if (message.fields.routingKey === request.properties.replyTo)
      interrupt = true
  })

  async function transmit (data, properties) {
    const ok = await send(data, properties)

    if (!ok) cancel()
  }

  function cancel () {
    interrupt = true
    stream.destroy()
  }

  /** @type {ReturnType<setInterval> | null} */
  let interval = null

  function heartbeat () {
    if (interval !== null) clearInterval(interval)

    interval = setInterval(
      () => transmit(control.heartbeat, properties.control),
      heartbeatInterval
    )
  }

  await transmit(control.ok, properties.control)

  heartbeat()

  for await (const chunk of stream) {
    await transmit(chunk, properties.chunk)

    heartbeat()

    if (interrupt) break
  }

  clearInterval(interval)
  if (!interrupt) await send(control.end, properties.control)
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

const HEARTBEAT_INTERVAL = 10_000
const IDLE_INTERVAL = HEARTBEAT_INTERVAL * 1.5

exports.createReplyEmitter = createReplyEmitter
exports.ReplyStream = ReplyStream
exports.pipe = pipe
