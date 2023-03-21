'use strict'

const { EventEmitter } = require('node:events')
const { promex, sample } = require('@toa.io/generic')
const events = require('../events')

/**
 * @implements {comq.Channel}
 */
class Channel {
  sharded = true

  /** @type {comq.Connection[]} */
  #connections

  /** @type {Set<comq.Channel>} */
  #channels = new Set()

  /** @type {comq.Channel[]} */
  #pool

  /** @type {Set<Promise<comq.Channel>>} */
  #pending = new Set()

  /** @type {Record<comq.Channel, toa.generic.Promex>} */
  #bench = {}

  /** @type {comq.topology.type} */
  #type

  #recovery = promex()

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
    const promises = this.#connections.map(this.#create)

    await Promise.any(promises)
  }

  async consume (queue, consumer) {
    await this.#any((channel) => channel.consume(queue, consumer))
  }

  async subscribe (queue, group, consumer) {
    await this.#any((channel) => channel.subscribe(queue, group, consumer))
  }

  async send (queue, buffer, options) {
    await this.#one((channel) => channel.send(queue, buffer, options))
  }

  async publish (exchange, buffer, options) {
    await this.#one((channel) => channel.publish(exchange, buffer, options))
  }

  async throw (queue, buffer, options) {
    await this.#one((channel) => channel.throw(queue, buffer, options))
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
    const pending = connection.createChannel(this.#type, index)
    const channel = await this.#pend(pending)

    this.#add(channel)
    this.#pipe(channel)

    channel.diagnose('recover', () => this.#recover(channel))
  }

  /**
   * @param {Promise<comq.Channel>} pending
   * @return {Promise<comq.Channel>}
   */
  async #pend (pending) {
    this.#pending.add(pending)

    const channel = await pending

    this.#pending.delete(pending)

    return channel
  }

  /**
   * @param {comq.Channel} channel
   */
  #pipe (channel) {
    for (const event of events.channel) {
      channel.diagnose(event, (...args) => this.#diagnostics.emit(event, ...args, channel.index))
    }
  }

  /**
   * @param {comq.Channel} channel
   */
  #add (channel) {
    this.#channels.add(channel)
    this.#pool = Array.from(this.#channels)
  }

  /**
   * @param {comq.Channel} channel
   */
  #remove (channel) {
    if (!this.#channels.has(channel)) return

    this.#diagnostics.emit('remove', channel.index)

    this.#bench[channel] = promex()
    this.#channels.delete(channel)
    this.#pool = Array.from(this.#channels)
  }

  /**
   * @param {comq.Channel} channel
   */
  #recover (channel) {
    if (channel in this.#bench) this.#comeback(channel)

    this.#add(channel)

    this.#recovery.resolve()
    this.#recovery = promex()
  }

  #comeback (channel) {
    this.#bench[channel].resolve(channel)
    delete this.#bench[channel]
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
    for (const recover of Object.values(this.#bench)) promises.push(recover.then(fn))

    return promises
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<void>}
   */
  async #one (fn) {
    if (this.#pool.length === 0) await this.#recovery

    const channel = sample(this.#pool)

    try {
      await fn(channel)
    } catch (e) {
      this.#remove(channel)
      await this.#one(fn)
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
