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

  /** @type {Map<comq.Channel, toa.generic.Promex>} */
  #bench = new Map()

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
    return await this.#any((channel) => channel.consume(queue, consumer))
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

  async fire (queue, buffer, options) {
    // noinspection  JSValidateTypes
    return await this.#one((channel) => channel.fire(queue, buffer, options))
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

    channel.diagnose('flow', () => this.#remove((channel)))
    channel.diagnose('drain', () => this.#recover(channel))
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
    this.#update()
  }

  /**
   * @param {comq.Channel} channel
   */
  #remove (channel) {
    if (!this.#channels.has(channel)) return

    this.#bench.set(channel, promex())
    this.#channels.delete(channel)
    this.#update()
    this.#diagnostics.emit('remove', channel.index)
  }

  #update () {
    const from = this.#pool?.length
    const to = this.#channels.size

    this.#pool = Array.from(this.#channels)

    if (from === undefined) return

    if (from !== 0 && to === 0) { this.#diagnostics.emit('pause') }

    if (from === 0 && to !== 0) { this.#diagnostics.emit('resume') }
  }

  /**
   * @param {comq.Channel} channel
   */
  #recover (channel) {
    if (this.#bench.has(channel)) this.#comeback(channel)

    this.#add(channel)

    this.#recovery.resolve()
    this.#recovery = promex()
  }

  #comeback (channel) {
    this.#bench.get(channel).resolve(channel)
    this.#bench.delete(channel)
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   */
  async #any (fn) {
    const promises = this.#apply(fn)

    return await Promise.any(promises)
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
    for (const recover of this.#bench.values()) promises.push(recover.then(fn))

    return promises
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   */
  async #one (fn) {
    if (this.#pool.length === 0) await this.#recovery

    const channel = sample(this.#pool)

    try {
      return await fn(channel)
    } catch {
      this.#remove(channel)

      return await this.#one(fn)
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
