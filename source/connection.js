'use strict'

const { EventEmitter } = require('node:events')
const amqp = require('amqplib')
const { retry, promex, failsafe } = require('@toa.io/generic')

const presets = require('./presets')
const channels = require('./channel')

/**
 * @implements {comq.Connection}
 */
class Connection {
  /** @type {string} */
  #url

  /** @type {import('amqplib').Connection} */
  #connection

  /** @type {comq.Channel[]} */
  #channels = []

  /** @type {toa.generic.Promex} */
  #recovery = promex()

  #diagnostics = new EventEmitter()

  /**
   * @param {string} url
   */
  constructor (url) {
    this.#url = url
  }

  async open () {
    await retry((retry) => this.#open(retry), RETRY)
  }

  async close () {
    await this.#connection.close()
  }

  createChannel = failsafe(this, this.#recover,
    async (type) => {
      const preset = presets[type]
      const channel = await channels.create(this.#connection, preset)

      this.#channels.push(channel)

      return channel
    })

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  /**
   * @param {Function} retry
   */
  async #open (retry) {
    try {
      this.#connection = await amqp.connect(this.#url)
    } catch (exception) {
      if (transient(exception)) return retry()
      else throw exception
    }

    this.#connection.on('close', this.#close)

    // prevents process crash, 'close' will be emitted next
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    this.#connection.on('error', () => undefined)
    this.#diagnostics.emit('open')

    for (const channel of this.#channels) await channel.recover(this.#connection)

    this.#recovery.resolve()
    this.#recovery = promex()
  }

  /**
   * @param {Error} error
   */
  #close = async (error) => {
    this.#diagnostics.emit('close', error)

    this.#connection.removeAllListeners()

    if (error !== undefined) await this.open()
  }

  #recover () {
    return this.#recovery
  }
}

/** @type {toa.generic.retry.Options} */
const RETRY = {
  retries: Infinity
}

/**
 * @param {Error} exception
 * @returns {boolean}
 */
const transient = (exception) => {
  const refused = exception.code === 'ECONNREFUSED'
  const handshake = exception.message === 'Socket closed abruptly during opening handshake'

  return refused || handshake
}

exports.Connection = Connection
