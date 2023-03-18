'use strict'

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
    await this.#apply((channel) => channel.consume(queue, consumer))
  }

  async subscribe (queue, group, consumer) {
    await this.#apply((channel) => channel.subscribe(queue, group, consumer))
  }

  /**
   * @param {comq.Connection} connection
   * @return {Promise<void>}
   */
  #create = async (connection) => {
    const pending = connection.createChannel(this.#type, true)

    this.#pending.add(pending)

    const channel = await pending

    this.#pending.delete(pending)
    this.#channels.add(channel)
  }

  /**
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<void>}
   */
  async #apply (fn) {
    const promises = []

    for (const channel of this.#channels) promises.push(fn(channel))
    for (const pending of this.#pending) pending.then(fn)

    await Promise.any(promises)
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
