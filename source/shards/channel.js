'use strict'

const { EventEmitter } = require('node:events')
const events = require('../events')

/**
 * @implements {comq.Channel}
 */
class Channel {
  /** @type {comq.Connection[]} */
  #connections

  /** @type {Set<comq.Channel>} */
  #channels = new Set()

  /** @type {Set<Promise<comq.Channel>>} */
  #pending = new Set()

  /** @type {comq.topology.type} */
  #type

  #diagnostics = new EventEmitter()

  /**
   * @param {comq.Connection[]} connections
   * @param {comq.topology.type} type
   */
  constructor (connections, type) {
    this.#connections = connections
    this.#type = type
  }

  async create () {
    const creating = this.#connections.map(this.#create)

    await Promise.any(creating)
  }

  async consume (queue, consumer) {
    await this.#any((channel) => channel.consume(queue, consumer))
  }

  async subscribe (queue, group, consumer) {
    await this.#any((channel) => channel.subscribe(queue, group, consumer))
  }

  async seal () {
    await this.#all((channel) => channel.seal())
  }

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  /**
   * @param {comq.Connection} connection
   * @param {number} index
   * @return {Promise<void>}
   */
  #create = async (connection, index) => {
    const pending = connection.createChannel(this.#type, true)

    this.#pending.add(pending)

    const channel = await pending

    this.#pending.delete(pending)
    this.#channels.add(channel)
    this.#pipe(channel, index)
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<void>}
   */
  async #any (fn) {
    const promises = this.#apply(fn)

    await Promise.any(promises)
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<void>}
   */
  async #all (fn) {
    const promises = this.#apply(fn)

    await Promise.all(promises)
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<any>[]}
   */
  #apply (fn) {
    const promises = []

    for (const channel of this.#channels) promises.push(fn(channel))
    for (const pending of this.#pending) promises.push(pending.then(fn))

    return promises
  }

  /**
   * @param {comq.Channel} channel
   * @param {number} index
   */
  #pipe (channel, index) {
    for (const event of events.channel) {
      channel.diagnose(event, (...args) => this.#diagnostics.emit(event, ...args, index))
    }
  }
}

/**
 * @param {comq.Connection[]} connections
 * @param {comq.topology.type} type
 * @return {comq.Channel}
 */
async function create (connections, type) {
  const channel = new Channel(connections, type)

  await channel.create()

  return channel
}

exports.create = create
