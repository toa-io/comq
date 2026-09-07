'use strict'

const { EventEmitter } = require('node:events')
const { Promex } = require('promex')
const { control, FLOW_HEADER, HEARTBEAT_INTERVAL } = require('./const')

/** @typedef {(message: any, properties?: comq.amqp.options.Publish) => Promise<void>} Reply */

class ReplyPipe extends EventEmitter {
  #index = -1
  #interrupted = false
  #closed = false
  #heartbeatInterval = global['COMQ_TESTING_HEARTBEAT_INTERVAL'] || HEARTBEAT_INTERVAL

  /** @type {ReturnType<setInterval> | null} */
  #interval = null

  /** Closed while the consumer has asked for a pause. */
  #gate = null

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
    super()

    const { correlationId, replyTo } = request.properties

    this.#stream = stream
    this.#channel = channel
    this.#feedback = feedback
    this.#reply = reply
    this.#replyTo = replyTo

    this.#properties = {
      chunk: { correlationId, ...CHUNK },
      control: { correlationId, replyTo: feedback.queue, ...CONTROL },
      ok: { correlationId, replyTo: feedback.queue, ...CONTROL, headers: FLOW }
    }

    channel.diagnose('return', this.#onReturn)
    feedback.on(correlationId, this.#control)
  }

  async pipe () {
    await this.#transmit(control.ok, this.#properties.ok)

    if (this.#closed) return

    this.#heartbeat()

    void this.#pump()
  }

  destroy () {
    this.#close()
    this.#stream.destroy()
  }

  /**
   * The source is pulled rather than listened to: a value is asked for once the
   * previous one has been handed to the channel, so a paused channel or a paused
   * consumer holds the source back instead of piling its output up here.
   */
  async #pump () {
    try {
      for await (const chunk of this.#stream) {
        if (this.#gate !== null) await this.#gate
        if (this.#closed) break

        await this.#transmit(chunk, this.#properties.chunk)

        if (this.#closed) break

        this.#heartbeat()
      }
    } catch {
      // the source has been destroyed, by this pipe or by whoever made it
    }

    this.#close()
  }

  async #transmit (data, properties) {
    this.#index++

    const headers = { ...properties.headers, index: this.#index }
    const ok = await this.#reply(data, { ...properties, headers })

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
    this.destroy()
  }

  #clear () {
    clearInterval(this.#interval)

    this.#channel.forget('return', this.#onReturn)
    this.#feedback.off(this.#properties.control.correlationId, this.#control)
    this.#resume()
  }

  #resume () {
    this.#gate?.resolve()
    this.#gate = null
  }

  #close = () => {
    if (this.#closed) return

    this.#closed = true

    this.emit('close')
    this.#clear()

    if (!this.#interrupted) {
      void this.#transmit(control.end, this.#properties.control)
    }
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
      case control.pause:
        this.#gate ??= new Promex()
        break
      case control.resume:
        this.#resume()
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
   * @return {Promise<comq.Destroyable>}
   */
  static async create (request, stream, channel, control, reply) {
    const pipe = new ReplyPipe(request, stream, channel, control, reply)

    await pipe.pipe()

    return /** @type {comq.Destroyable} */ pipe
  }
}

/** @type {comq.amqp.options.Publish} */
const CHUNK = { mandatory: true }

/** @type {comq.amqp.options.Publish} */
const CONTROL = { type: 'control', mandatory: true }

const FLOW = { [FLOW_HEADER]: true }

exports.ReplyPipe = ReplyPipe
