'use strict'

const { randomBytes } = require('node:crypto')
const { concat } = require('./concat')

/**
 * Routes the replies arriving on a queue to whoever is waiting for them.
 *
 * A Map keyed by correlation identifier rather than an EventEmitter: with
 * thousands of requests in flight the emitter's event table degrades into a
 * dictionary, and every `once` costs a wrapper.
 *
 * @implements {comq.ReplyEmitter}
 */
class ReplyEmitter {
  /** @type {string} */
  queue

  /** @type {string} */
  #prefix

  /** @type {number} */
  #sequence = 0

  /** @type {Map<string, comq.ReplyHandler>} */
  #handlers = new Map()

  /**
   * @param {string} label
   */
  constructor (label) {
    const id = randomBytes(8).toString('hex')

    this.queue = concat(label, id)
    this.#prefix = id
  }

  /**
   * A correlation identifier that is unique across processes as well: the
   * control queue of a producer sees the requests of every consumer, and tells
   * them apart by nothing else. Random bytes per request would cost more than
   * everything else on the way to the broker put together.
   *
   * @return {string}
   */
  next () {
    return this.#prefix + (++this.#sequence).toString(36)
  }

  /**
   * @param {string} id
   * @param {comq.ReplyHandler} handler
   */
  on (id, handler) {
    this.#handlers.set(id, handler)
  }

  /**
   * @param {string} id
   * @param {comq.ReplyHandler} [handler] the one to remove, or whichever is there
   */
  off (id, handler) {
    if (handler === undefined || this.#handlers.get(id) === handler) this.#handlers.delete(id)
  }

  /**
   * @param {string} id
   * @param {any} payload
   * @param {comq.amqp.Properties} properties
   * @param {number} [size] of the encoded payload
   * @return {boolean} whether anyone was waiting
   */
  emit (id, payload, properties, size) {
    const handler = this.#handlers.get(id)

    if (handler === undefined) return false

    handler(payload, properties, size)

    return true
  }

  /** How many replies are being waited for. */
  get pending () {
    return this.#handlers.size
  }
}

/**
 * @param {string} label
 * @returns {comq.ReplyEmitter}
 */
function createReplyEmitter (label) {
  return new ReplyEmitter(label)
}

exports.createReplyEmitter = createReplyEmitter
