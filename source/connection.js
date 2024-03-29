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

  /** @type {boolean} */
  #running = false

  #diagnostics = emitter.create()

  /**
   * @param {string} url
   */
  constructor (url) {
    this.#url = url
  }

  async open () {
    await retry(this.#open)

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
    try {
      this.#connection = await amqp.connect(this.#url)
    } catch (exception) {
      if (this.#transient(exception)) return retry
      else throw exception
    }

    // This prevents the process from crashing; 'close' will be emitted next.
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    this.#connection.on('error', noop)

    this.#connection.on('close', this.#close)
    this.#diagnostics.emit('open')

    for (const channel of this.#channels) await channel.recover(this.#connection)

    this.#recovery.resolve()
    this.#recovery = new Promex()
  }

  /**
   * @param {Error} error
   */
  #close = async (error) => {
    this.#diagnostics.emit('close', error)
    this.#connection.removeAllListeners()
    this.#connection = undefined

    if (error !== undefined) await this.open()
  }

  #recover () {
    return this.#recovery
  }

  #transient (exception) {
    const abruptly = exception.message === 'Socket closed abruptly during opening handshake'

    return this.#running || abruptly
  }
}

function noop () {}

exports.Connection = Connection
