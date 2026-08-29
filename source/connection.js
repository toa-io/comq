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
    this.#url = heartbeaten(url)

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

    if (this.#closed) return

    // close may have landed after this attempt succeeded but before `#opening` was cleared
    if (this.#connection === undefined) return this.open()

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

    // amqplib keeps its heartbeater running on a connection it does not know is
    // gone and emits 'error' on it, which throws once no listener is left
    connection.on('error', noop)

    // a socket destroyed without an error tells amqplib nothing, leaving its
    // timers running and everything pending on it hanging forever
    connection.connection?.stream?.destroy(silence())
  }

  #recover () {
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

  /**
   * @param {comq.amqp.Connection} connection
   * @param {number} [timeoutMs]
   */
  #armWatchdog (connection, timeoutMs = tolerance(connection)) {
    this.#disarmWatchdog()

    const socket = connection.connection?.stream

    if (socket === undefined || timeoutMs === undefined) return

    const reset = () => {
      clearTimeout(this.#heartbeatTimer)
      // destroying a socket without an error tells amqplib nothing: it only
      // listens for 'error' and 'end', so a bare destroy() leaves the connection
      // silently dead — no 'close' event, no recovery, every pending operation
      // hanging forever
      this.#heartbeatTimer = setTimeout(() => socket.destroy(silence()), timeoutMs)
      this.#heartbeatTimer.unref()
    }

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

/**
 * The heartbeat to ask for when the caller has not, in seconds. A broker is free
 * to suggest one that leaves a connection lost for minutes before anything
 * notices, and RabbitMQ suggests 60 by default.
 *
 * @type {number}
 */
const HEARTBEAT_S = 15

/** @type {number} */
const KEEPALIVE_MS = 10_000

/** How many heartbeats a connection may miss before it is destroyed. */
const MISSED_HEARTBEATS = 3

/** @type {number} */
const WATCHDOG_MIN_MS = 15_000

/** The watchdog interval used when the negotiated heartbeat is unknown. */
const WATCHDOG_MS = 60_000

/** @type {number} */
const CONNECT_MS = 30_000

/** @type {number} */
const SHUTDOWN_MS = 5_000

const SOCKET_OPTIONS = {
  timeout: CONNECT_MS,
  // a peer that went away without a word is noticed by the kernel as well
  keepAlive: true,
  keepAliveDelay: KEEPALIVE_MS
}

const HEARTBEAT_SET = /[?&]heartbeat=/

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
 * The watchdog measures silence, so it cannot be shorter than the interval at
 * which a healthy broker is expected to say something, which is a heartbeat
 * frame every half a heartbeat. A connection that has agreed to no heartbeats
 * says nothing at all while it is idle, leaving nothing to measure.
 *
 * @param {comq.amqp.Connection} connection
 * @return {number | undefined}
 */
function tolerance (connection) {
  const override = global.COMQ_TESTING_WATCHDOG_INTERVAL

  if (override !== undefined) return override

  const heartbeat = connection.connection?.heartbeat

  if (heartbeat === undefined) return WATCHDOG_MS
  if (heartbeat === 0) return undefined

  return Math.max(heartbeat * MISSED_HEARTBEATS * 1000, WATCHDOG_MIN_MS)
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
