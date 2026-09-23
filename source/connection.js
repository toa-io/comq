'use strict'

const { setTimeout: delay } = require('node:timers/promises')
const amqp = require('@toa.io/amqplib')
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

  /** @type {Set<comq.Channel>} */
  #channels = new Set()

  /** @type {Promex} */
  #recovery = new Promex()

  /** @type {Promise<void> | null} */
  #opening = null

  /** @type {boolean} */
  #running = false

  /** @type {boolean} */
  #closed = false

  /** @type {comq.topology.Overrides} */
  #overrides

  #diagnostics = emitter.create()

  /**
   * @param {string} url
   */
  /**
   * @param {string} url
   * @param {comq.topology.Overrides} [overrides] per channel type, merged over the presets
   */
  constructor (url, overrides = {}) {
    this.#url = heartbeaten(url)
    this.#overrides = overrides
  }

  get connected () {
    return this.#connection !== undefined
  }

  get closed () {
    return this.#closed
  }

  async open () {
    this.#closed = false

    await this.#reopen()

    if (this.#closed) return

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

      // a copy: the presets are shared by every connection in the process
      const topology = { ...presets[type], ...this.#overrides[type] }

      // a closed channel held here would hold its IO, and a shared connection is
      // in no hurry to make another channel that would have swept it out
      const release = (channel) => this.#channels.delete(channel)
      const channel = await channels.create(this.#connection, topology, index, release)

      this.#channels.add(channel)

      return channel
    })

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  forget (event, listener) {
    this.#diagnostics.off(event, listener)
  }

  #open = async (retry) => {
    if (this.#closed) return

    // the initial connect finishes before the caller can subscribe
    if (this.#running) this.#diagnostics.emit('reconnect')

    /** @type {comq.amqp.Connection} */
    let connection

    try {
      connection = await this.#connect()
    } catch (exception) {
      if (this.#closed) return
      if (!this.#transient(exception)) throw exception

      this.#diagnostics.emit('error', exception)

      return retry
    }

    if (this.#closed) return await this.#shutdown(connection)

    // This prevents the process from crashing; 'close' will be emitted next.
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    connection.on('error', noop)

    connection.on('close', (error) => this.#close(connection, error))
    this.#connection = connection

    this.#diagnostics.emit('open')

    try {
      for (const channel of this.#channels) {
        if (channel.closed) this.#channels.delete(channel)
        else await channel.recover(connection)
      }
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

    this.#diagnostics.emit('close', error)
    connection.removeAllListeners()
    this.#connection = undefined

    // amqplib only ends the socket of a connection it has given up on, and a peer that has gone
    // silent never ends its side, which would leave the socket to the kernel's keepalive
    if (error !== undefined) connection.connection?.stream?.destroy()

    if (error !== undefined && !this.#closed) {
      this.#reopen().catch((exception) => this.#diagnostics.emit('error', exception))
    }
  }

  /**
   * Establishes the connection, or joins the attempt under way. A lost connection is
   * restored through here and not through `open()`: what a subclass makes of `open()` is
   * its own — the singleton answers it with the first opening, made once and remembered,
   * which is no way to make a second one.
   *
   * @return {Promise<void>}
   */
  async #reopen () {
    this.#opening ??= retry(this.#open).finally(() => { this.#opening = null })

    await this.#opening

    if (this.#closed) return

    // close may have landed after this attempt succeeded but before `#opening` was cleared
    if (this.#connection === undefined) return this.#reopen()
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
    if (this.#connection === connection) this.#connection = undefined

    connection.removeAllListeners()

    // amqplib keeps its heartbeater running on a connection it does not know is
    // gone and emits 'error' on it, which throws once no listener is left
    connection.on('error', noop)

    // a socket destroyed without an error tells amqplib nothing, leaving its
    // timers running and everything pending on it hanging forever
    connection.connection?.stream?.destroy(silence())
  }

  /**
   * @param {Error} [exception]
   * @return {Promise<void> | false}
   */
  #recover (exception) {
    // a connection that has no channel left to give is not something reconnecting
    // fixes, and `#recovery` on a connection that is perfectly well is a promise
    // nobody ever resolves — returning `false` lets the caller see the refusal
    if (exception?.message === EXHAUSTED) {
      this.#diagnostics.emit('exhausted', this.#connection?.connection?.channelMax)

      return false
    }

    return this.#recovery
  }

  /**
   * amqplib's `timeout` is a socket idle timer and starts only after DNS.
   * After a machine wakes, `getaddrinfo` itself can hang, so the attempt is
   * also bounded here.
   *
   * @return {Promise<comq.amqp.Connection>}
   */
  async #connect () {
    const connecting = amqp.connect(this.#url, SOCKET_OPTIONS)

    let timer

    const expired = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const exception = new Error('connect ETIMEDOUT')

        exception.code = 'ETIMEDOUT'

        reject(exception)
      }, CONNECT_MS)

      timer.unref()
    })

    expired.catch(noop)

    try {
      return await Promise.race([connecting, expired])
    } catch (exception) {
      connecting.then((connection) => this.#shutdown(connection), noop)

      throw exception
    } finally {
      clearTimeout(timer)
    }
  }

  #transient (exception) {
    if (this.#running) return true
    if (TRANSIENT_CODES.has(exception.code)) return true
    if (TRANSIENT_MESSAGES.has(exception.message)) return true

    return false
  }
}

/**
 * The heartbeat to ask for when the caller has not, in seconds. A broker is free
 * to suggest one that leaves a connection lost for minutes before anything
 * notices, and RabbitMQ suggests 60 by default.
 *
 * It is amqplib that tells a connection gone silent: one that has received nothing
 * for two heartbeats is closed with an error, whatever the broker and the operating
 * system have reported, which is what restores it.
 *
 * @type {number}
 */
const HEARTBEAT_S = 15

/** @type {number} */
const KEEPALIVE_MS = 10_000

/** @type {number} */
const CONNECT_MS = 30_000

/** @type {number} */
const SHUTDOWN_MS = 5_000

const SOCKET_OPTIONS = {
  timeout: CONNECT_MS,
  // a message is written once and is small, which is what Nagle's algorithm holds back
  noDelay: true,
  // a peer that went away without a word is noticed by the kernel as well
  keepAlive: true,
  keepAliveDelay: KEEPALIVE_MS
}

const HEARTBEAT_SET = /[?&]heartbeat=/

/** What amqplib says when the negotiated channel limit leaves no identifier free. */
const EXHAUSTED = 'No channels left to allocate'

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

/**
 * amqplib reads the heartbeat from the URL only, hence it cannot be passed along
 * with the socket options.
 *
 * @param {string} url
 * @return {string}
 */
function heartbeaten (url) {
  if (HEARTBEAT_SET.test(url)) return url

  return url + (url.includes('?') ? '&' : '?') + 'heartbeat=' + HEARTBEAT_S
}

/**
 * @return {Error}
 */
function silence () {
  const exception = new Error('Connection is silent')

  exception.code = 'ETIMEDOUT'

  return exception
}

function noop () {}

exports.Connection = Connection
