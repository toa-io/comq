'use strict'

const events = require('../events')
const channel = require('./channel')
const emitter = require('../emitter')

/**
 * @implements {comq.Connection}
 */
class Connection {
  /** @type {comq.Connection[]} */
  #connections

  #diagnostics = emitter.create()

  /**
   * @param {comq.Connection[]} connections
   */
  constructor (connections) {
    this.#connections = connections

    connections.map(this.#pipe)
  }

  async open () {
    const openings = this.#connections.map((connection) => connection.open())

    try {
      await Promise.all(openings)
    } catch (exception) {
      await this.#cancel(openings, exception)
    }
  }

  async close () {
    const closing = this.#connections.map((connection) => connection.close())

    await Promise.all(closing)
  }

  async createChannel (type) {
    return channel.create(this.#connections, type)
  }

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  /**
   * @param {comq.Connection} connection
   * @param {number} index
   */
  #pipe = (connection, index) => {
    for (const event of events.connection) {
      connection.diagnose(event, (...args) => this.#diagnostics.emit(event, ...args, index))
    }
  }

  /**
   * @param {Promise<any>[]} openings
   * @param {Error} exception
   */
  async #cancel (openings, exception) {
    const settled = await Promise.allSettled(openings)
    const indexes = settled.map((result, index) => result.status === 'fulfilled' ? index : -1)
    const opened = indexes.filter((index) => index !== -1)
    const closings = opened.map((index) => this.#connections[index].close())

    await Promise.all(closings)

    throw exception
  }
}

exports.Connection = Connection
