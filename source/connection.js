'use strict'

const { setTimeout: delay } = require('node:timers/promises')
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

  /** @type {boolean} */
  #closed = false

  /** @type {NodeJS.Timeout | null} */
  #heartbeatTimer = null

  /** @type {import('node:net').Socket | null} */
  #heartbeatSocket = null

  /** @type {(() => void) | null} */
  #heartbeatReset = null

  #diagnostics = emitter.create()

  /**
   * @param {string} url
   */
  constructor (url) {
    this.#url = url

    // EventEmitter throws on 'error' with no listeners
    this.#diagnostics.on('error', noop)
  }

  get connected () {
    return this.#connection !== undefined
  }

  get closed () {
    return this.#closed
  }

  async open () {
    this.#closed = false

    if (this.#opening !== null) return this.#opening

    this.#opening = retry(this.#open).finally(() => { this.#opening = null })

    await this.#opening

    this.#running = true
  }

  async close () {
    this.#closed = true

    // a connection that is about to be established must not be left open, yet an
    // attempt that is being retried must not hold up the shutdown
    if (this.#opening !== null) await Promise.race([this.#opening.catch(noop), expiration()])
    if (this.#connection !== undefined) await this.#shutdown(this.#connection)
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
    if (this.#closed) return

    /** @type {comq.amqp.Connection} */
    let connection

    try {
      connection = await amqp.connect(this.#url, { timeout: CONNECT_MS })
    } catch (exception) {
      if (this.#closed) return
      if (!this.#transient(exception)) throw exception

      // attempts are made until one succeeds, so an outage is observable only here
      this.#diagnostics.emit('error', exception)

      return retry
    }

    if (this.#closed) return await this.#shutdown(connection)

    // This prevents the process from crashing; 'close' will be emitted next.
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    connection.on('error', noop)

    connection.on('close', (error) => this.#close(connection, error))
    this.#connection = connection
    this.#armWatchdog(connection)
    this.#diagnostics.emit('open')

    try {
      for (const channel of this.#channels) await channel.recover(connection)
    } catch (exception) {
      this.#diagnostics.emit('error', exception)
      this.#drop(connection)

      return retry
    }

    // the connection may have been lost while the topology was being recovered,
    // in which case 'close' has left the reconnection to this very attempt
    if (this.#connection !== connection) return retry

    this.#recovery.resolve()
    this.#recovery = new Promex()
  }

  /**
   * @param {comq.amqp.Connection} connection
   * @param {Error} [error]
   */
  #close = (connection, error) => {
    if (this.#connection !== connection) return

    this.#disarmWatchdog()
    this.#diagnostics.emit('close', error)
    connection.removeAllListeners()
    this.#connection = undefined

    if (error !== undefined && !this.#closed) {
      this.open().catch((exception) => this.#diagnostics.emit('error', exception))
    }
  }

  /**
   * An AMQP connection is only closed once the broker has replied with Close-Ok,
   * which never happens on a connection that has already been lost.
   *
   * @param {comq.amqp.Connection} connection
   */
  async #shutdown (connection) {
    const closing = connection.close().catch(noop)

    await Promise.race([closing, expiration()])

    this.#drop(connection)
  }

  /**
   * @param {comq.amqp.Connection} connection
   */
  #drop (connection) {
    if (this.#connection === connection) {
      this.#disarmWatchdog()
      this.#connection = undefined
    }

    connection.removeAllListeners()
    connection.connection?.stream?.destroy()
  }

  #recover () {
    return this.#recovery
  }

  /**
   * @param {comq.amqp.Connection} connection
   * @param {number} [timeoutMs]
   */
  #armWatchdog (connection, timeoutMs = global.COMQ_TESTING_WATCHDOG_INTERVAL ?? WATCHDOG_MS) {
    const socket = connection.connection?.stream

    if (socket === undefined) return

    const reset = () => {
      clearTimeout(this.#heartbeatTimer)
      this.#heartbeatTimer = setTimeout(() => socket.destroy(), timeoutMs)
      this.#heartbeatTimer.unref()
    }

    this.#disarmWatchdog()

    this.#heartbeatSocket = socket
    this.#heartbeatReset = reset

    reset()
    socket.on('data', reset)
  }

  #disarmWatchdog () {
    clearTimeout(this.#heartbeatTimer)
    this.#heartbeatTimer = null

    // otherwise a byte arriving on a replaced socket rearms the watchdog of a
    // connection that is already gone, leaving the current one unguarded
    this.#heartbeatSocket?.off('data', this.#heartbeatReset)

    this.#heartbeatSocket = null
    this.#heartbeatReset = null
  }

  #transient (exception) {
    if (this.#running) return true
    if (TRANSIENT_CODES.has(exception.code)) return true
    if (TRANSIENT_MESSAGES.has(exception.message)) return true

    return false
  }
}

/** @type {number} */
const WATCHDOG_MS = 60_000

/** @type {number} */
const CONNECT_MS = 30_000

/** @type {number} */
const SHUTDOWN_MS = 5_000

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
  'Client network socket disconnected before secure TLS connection was established',
  'connect ETIMEDOUT' // amqplib reports the `timeout` option without a code
])

/**
 * @return {Promise<void>}
 */
function expiration () {
  const timeoutMs = global.COMQ_TESTING_SHUTDOWN_TIMEOUT ?? SHUTDOWN_MS

  return delay(timeoutMs, undefined, { ref: false })
}

function noop () {}

exports.Connection = Connection
