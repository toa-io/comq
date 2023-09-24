'use strict'

const { control, HEARTBEAT_INTERVAL } = require('./const')

/** @typedef {(message: any, properties?: comq.amqp.options.Publish) => Promise<void>} Reply */

class Pipe {
  #index = -1
  #interrupted = false
  #heartbeatInterval = global['COMQ_TESTING_HEARTBEAT_INTERVAL'] || HEARTBEAT_INTERVAL

  /** @type {ReturnType<setInterval> | null} */
  #interval = null

  /** @type {string} */
  #replyTo

  /** @type {Record<string, comq.amqp.options.Publish>} */
  #properties

  /** @type {import('node:stream').Readable} */
  #stream

  /** @type {comq.Channel} */
  #channel

  /** @type {comq.ReplyEmitter} */
  #feedback

  /** @type {Reply} */
  #reply

  /**
   * @param {comq.amqp.Message} request
   * @param {stream.Readable} stream
   * @param {comq.Channel} channel
   * @param {comq.ReplyEmitter} feedback
   * @param {Reply} reply
   */
  constructor (request, stream, channel, feedback, reply) {
    const { correlationId, replyTo } = request.properties

    this.#stream = stream
    this.#channel = channel
    this.#feedback = feedback
    this.#reply = reply
    this.#replyTo = replyTo

    this.#properties = {
      chunk: { correlationId, ...CHUNK },
      control: { correlationId, replyTo: feedback.queue, ...CONTROL }
    }

    channel.diagnose('return', this.#onReturn)
    feedback.on(correlationId, this.#control)
  }

  async pipe () {
    await this.#transmit(control.ok, this.#properties.control)

    this.#stream.on('data', this.#onData)
    this.#stream.on('close', this.#onClose)
    this.#heartbeat()
  }

  async #transmit (data, properties) {
    this.#index++

    const ok = await this.#reply(data,
      { ...properties, headers: { index: this.#index } })

    if (!ok) this.#interrupt()
  }

  #heartbeat () {
    if (this.#interval !== null) clearInterval(this.#interval)

    this.#interval = setInterval(
      () => this.#transmit(control.heartbeat, this.#properties.control),
      this.#heartbeatInterval
    )
  }

  #interrupt () {
    this.#interrupted = true
    this.#stream.destroy()
  }

  #clear () {
    clearInterval(this.#interval)

    this.#channel.forget('return', this.#onReturn)
    this.#feedback.off(this.#properties.control.correlationId, this.#control)
  }

  #onData = async (chunk) => {
    await this.#transmit(chunk, this.#properties.chunk)

    this.#heartbeat()
  }

  #onClose = async () => {
    this.#clear()

    if (!this.#interrupted) await this.#transmit(control.end, this.#properties.control)
  }

  #onReturn = (message) => {
    if (message.fields.routingKey === this.#replyTo)
      this.#interrupt()
  }

  #control = (message) => {
    switch (message) {
      case control.end:
        this.#interrupt()
        break
      default:
        throw new Error(`Unknown control message: ${message}`)
    }
  }

  /**
   * @param {comq.amqp.Message} request
   * @param {stream.Readable} stream
   * @param {comq.Channel} channel
   * @param {comq.ReplyEmitter} control
   * @param {Reply} reply
   * @return {Promise<void>}
   */
  static async create (request, stream, channel, control, reply) {
    const pipe = new Pipe(request, stream, channel, control, reply)

    await pipe.pipe()
  }
}

/** @type {comq.amqp.options.Publish} */
const CHUNK = { mandatory: true }

/** @type {comq.amqp.options.Publish} */
const CONTROL = { type: 'control', mandatory: true }

exports.Pipe = Pipe
