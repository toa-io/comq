'use strict'

const { EventEmitter } = require('node:events')
const events = require('../events')
const channel = require('./channel')

/**
 * @implements {comq.Connection}
 */
class Connection {
  /** @type {comq.Connection[]} */
  #connections

  #diagnostics = new EventEmitter()

  /**
   * @param {comq.Connection[]} connections
   */
  constructor (connections) {
    this.#connections = connections

    connections.map(this.#pipe)
  }

  async open () {
    const connecting = this.#connections.map((connection) => connection.open())

    await Promise.any(connecting)
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
}

exports.Connection = Connection
