'use strict'

const amqp = require('amqplib')
const { Promex } = require('promex')
const { retry } = require('reretry')

const { failsafe } = require('./attributes')
const presets = require('./topology')
const channels = require('./channel')
const emitter = require('./emitter')

/**
 * @implements {comq.Connection}
 */
class Connection {
  /** @type {string} */
  #url

  /** @type {comq.amqp.Connection} */
  #connection

  /** @type {comq.Channel[]} */
  #channels = []

  /** @type {Promex} */
  #recovery = new Promex()

  /** @type {Promise<void> | null} */
  #opening = null

  /** @type {boolean} */
  #running = false

  #diagnostics = emitter.create()

  /**
   * @param {string} url
   */
  constructor (url) {
    this.#url = url

    // EventEmitter throws on 'error' with no listeners
    this.#diagnostics.on('error', noop)
  }

  async open () {
    if (this.#opening !== null) return this.#opening

    this.#opening = retry(this.#open).finally(() => { this.#opening = null })

    await this.#opening

    this.#running = true
  }

  async close () {
    if (this.#connection === undefined) await this.#recovery

    await this.#connection.close()
  }

  createChannel = failsafe(this, this.#recover,
    /**
     * @param {comq.topology.type} type
     * @param {number} [index]
     * @return {Promise<comq.Channel>}
     */
    async (type, index) => {
      if (this.#connection === undefined) await this.#recovery

      const topology = presets[type]
      const channel = await channels.create(this.#connection, topology, index)

      this.#channels.push(channel)

      return channel
    })

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  #open = async (retry) => {
    /** @type {comq.amqp.Connection} */
    let connection

    try {
      connection = await amqp.connect(this.#url)
    } catch (exception) {
      if (this.#transient(exception)) return retry
      else throw exception
    }

    // This prevents the process from crashing; 'close' will be emitted next.
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    connection.on('error', noop)

    connection.on('close', this.#close)
    this.#connection = connection
    this.#diagnostics.emit('open')

    try {
      for (const channel of this.#channels) await channel.recover(connection)
    } catch (exception) {
      this.#diagnostics.emit('error', exception)
      connection.removeAllListeners()

      await connection.close().catch(noop)

      if (this.#connection === connection) this.#connection = undefined

      return retry
    }

    this.#recovery.resolve()
    this.#recovery = new Promex()
  }

  /**
   * @param {Error} error
   */
  #close = (error) => {
    this.#diagnostics.emit('close', error)
    this.#connection.removeAllListeners()
    this.#connection = undefined

    if (error !== undefined) {
      this.open().catch((exception) => this.#diagnostics.emit('error', exception))
    }
  }

  #recover () {
    return this.#recovery
  }

  #transient (exception) {
    if (this.#running) return true
    if (TRANSIENT_CODES.has(exception.code)) return true
    if (TRANSIENT_MESSAGES.has(exception.message)) return true

    return false
  }
}

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH'
])

const TRANSIENT_MESSAGES = new Set([
  'Socket closed abruptly during opening handshake',
  'Client network socket disconnected before secure TLS connection was established'
])

function noop () {}

exports.Connection = Connection
