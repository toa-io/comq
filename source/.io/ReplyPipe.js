'use strict'

const { EventEmitter } = require('node:events')
const { Promex } = require('../promex')
const { control, batch, FLOW_HEADER, HEARTBEAT_INTERVAL } = require('./const')

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

  /** Whether the encoding can carry a list of values. */
  #lists

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

    this.#lists = request.properties.contentType === LISTS

    this.#properties = {
      chunk: { correlationId, ...CHUNK },
      batch: { correlationId, ...CHUNK, type: batch.values },
      buffers: { correlationId, ...CHUNK, type: batch.buffers },
      control: { correlationId, replyTo: feedback.queue, ...CONTROL },
      ok: { correlationId, replyTo: feedback.queue, ...CONTROL, headers: FLOW }
    }

    // The source is not read until the confirmation is published, and a blocked broker holds the
    // publish for as long as it stays blocked. A source failing in the meantime — a reply stream
    // being relayed times out — would raise an `error` nobody listens to. How it failed is not
    // reported to the consumer anyway: `#pump` ends the stream once it finds the source destroyed.
    stream.on('error', noop)

    channel.diagnose('return', this.#onReturn)
    feedback.on(correlationId, this.#control)
  }

  async pipe () {
    try {
      await this.#transmit(control.ok, this.#properties.ok)
    } catch (exception) {
      // nobody is going to read the source now
      this.#interrupt()

      throw exception
    }

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
      await this.#pumpBatches()
    } catch {
      // the source has been destroyed, by this pipe or by whoever made it
    }

    this.#close()
  }

  /**
   * Values go out together while they arrive together: what the source yields before the event
   * loop turns joins the message, and the first value that has to be waited for leaves with the
   * ones before it rather than waiting for company. A cursor yielding the documents of a batch it
   * holds sends them as one message; a source yielding one value at a time sends each as it
   * comes. Values and buffers travel in messages of their own, and values in an encoding that
   * holds no list travel one to a message.
   */
  async #pumpBatches () {
    const iterator = this.#stream[Symbol.asyncIterator]()

    let pending = next(iterator)

    while (true) {
      const first = await pending

      if (first.done === true) return

      const chunks = [first.value]
      const buffers = Buffer.isBuffer(first.value)
      const turn = immediate()

      let done = false

      pending = next(iterator)

      while (chunks.length < (buffers || this.#lists ? MAX_BATCH : 1)) {
        const arrived = await Promise.race([pending, turn])

        if (arrived === TURN) break

        if (arrived.done === true) {
          done = true

          break
        }

        // of the other kind, it starts the next message
        if (Buffer.isBuffer(arrived.value) !== buffers) {
          pending = Promise.resolve(arrived)

          break
        }

        chunks.push(arrived.value)
        pending = next(iterator)
      }

      if (!(await this.#send(...this.#message(chunks, buffers)))) {
        await iterator.return?.()

        return
      }

      if (done) return
    }
  }

  #message (chunks, buffers) {
    if (chunks.length === 1) return [chunks[0], this.#properties.chunk]
    else if (buffers) return [prefixed(chunks), this.#properties.buffers]
    else return [chunks, this.#properties.batch]
  }

  /** Answers whether the pipe goes on. */
  async #send (data, properties) {
    if (this.#gate !== null) await this.#gate
    if (this.#closed) return false

    await this.#transmit(data, properties)

    if (this.#closed) return false

    this.#heartbeat()

    return true
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

/** the most values a message carries */
const MAX_BATCH = 128

/** the encoding a batch of values is a list in */
const LISTS = 'application/json'

const TURN = Symbol('turn')

/**
 * The next value, asked for ahead of when it is awaited. A source that fails while a message is
 * being sent is found failed by the loop that awaits it next, or by nobody where the pipe has
 * stopped — and a rejection nobody awaits is an unhandled one.
 */
function next (iterator) {
  const pending = iterator.next()

  pending.catch(noop)

  return pending
}

/** Settles once the event loop has turned, with what says so. */
function immediate () {
  return new Promise((resolve) => setImmediate(resolve, TURN))
}

/**
 * @param {Buffer[]} buffers
 * @returns {Buffer}
 */
function prefixed (buffers) {
  const parts = []

  for (const buffer of buffers) {
    const length = Buffer.allocUnsafe(4)

    length.writeUInt32BE(buffer.length)
    parts.push(length, buffer)
  }

  return Buffer.concat(parts)
}

/** @type {comq.amqp.options.Publish} */
const CONTROL = { type: 'control', mandatory: true }

const FLOW = { [FLOW_HEADER]: true }

function noop () {}

exports.ReplyPipe = ReplyPipe
