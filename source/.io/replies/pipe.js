'use strict'

const { control, HEARTBEAT_INTERVAL } = require('./const')

/** @typedef {(message: any, properties?: comq.amqp.options.Publish) => Promise<void>} Reply */

class Pipe {
  #index = -1
  #interrupt = false
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

  /** @type {Reply} */
  #reply

  /**
   * @param {comq.amqp.Message} request
   * @param {stream.Readable} stream
   * @param {comq.Channel} channel
   * @param {Reply} reply
   */
  constructor (request, stream, channel, reply) {
    const { correlationId, replyTo } = request.properties

    this.#stream = stream
    this.#channel = channel
    this.#reply = reply
    this.#replyTo = replyTo

    this.#properties = {
      chunk: { correlationId, mandatory: true },
      control: { correlationId, type: 'control', mandatory: true }
    }

    channel.diagnose('return', this.#onReturn)
  }

  async pipe () {
    await this.#transmit(control.ok, this.#properties.control)

    this.#heartbeat()

    for await (const chunk of this.#stream) {
      await this.#transmit(chunk, this.#properties.chunk)

      this.#heartbeat()

      if (this.#interrupt) break
    }

    this.#clear()

    if (!this.#interrupt) await this.#transmit(control.end, this.#properties.control)
  }

  async #transmit (data, properties) {
    this.#index++

    const ok = await this.#reply(data,
      { ...properties, headers: { index: this.#index } })

    if (!ok) this.#cancel()
  }

  #heartbeat () {
    if (this.#interval !== null) clearInterval(this.#interval)

    this.#interval = setInterval(
      () => this.#transmit(control.heartbeat, this.#properties.control),
      this.#heartbeatInterval
    )
  }

  #cancel () {
    this.#interrupt = true
    this.#stream.destroy()
  }

  #clear () {
    clearInterval(this.#interval)
    this.#channel.forget('return', this.#onReturn)
  }

  #onReturn = (message) => {
    if (message.fields.routingKey === this.#replyTo)
      this.#interrupt = true
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
  const pipe = new Pipe(request, stream, channel, send)

  await pipe.pipe()
}

exports.pipe = pipe
