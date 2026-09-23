'use strict'

const { Promex } = require('promex')
const { RETRY_PREFIX } = require('../channel')
const events = require('../events')
const emitter = require('../emitter')

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

  /** @type {Map<Promise<comq.Channel>, number>} */
  #pending = new Map()

  /** @type {Promex[]} */
  #down = []

  /** @type {boolean[]} */
  #alive = []

  /** @type {Map<comq.Channel, Promex>} */
  #bench = new Map()

  /** @type {boolean} */
  #paused = false

  /** @type {comq.topology.type} */
  #type

  #recovery = new Promex()

  #diagnostics = emitter.create()

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

  /**
   * A message is told which shard it arrived on, so that whatever answers it can go back the same
   * way. See `fire`.
   */
  async consume (queue, consumer) {
    return await this.#every((channel) => channel.consume(queue, arrival(consumer, channel)))
  }

  async subscribe (queue, group, consumer) {
    await this.#every((channel) => channel.subscribe(queue, group, consumer))
  }

  async bound (exchange, queue, key, consumer) {
    await this.#every((channel) => channel.bound(exchange, queue, key, consumer))
  }

  /**
   * A key is held once any shard holds it. A shard where another connection holds it goes on
   * claiming it, and holds it as well once it is let go.
   */
  async held (exchange, queue, key, consumer) {
    await Promise.any(this.#apply((channel) => channel.held(exchange, queue, key, arrival(consumer, channel))))
  }

  /**
   * @param {string} queue
   * @param {Buffer} buffer
   * @param {comq.amqp.options.Publish} [options]
   * @param {(index: number) => void} [via] told which shard the message is published through,
   * as soon as one is chosen and again whenever the publish fails over to another
   */
  async send (queue, buffer, options, via) {
    await this.#one((channel) => channel.send(queue, buffer, options), { via })
  }

  async publish (exchange, buffer, options) {
    await this.#one((channel) => channel.publish(exchange, buffer, options))
  }

  /**
   * @param {string} exchange
   * @param {string} key
   * @param {Buffer} buffer
   * @param {comq.amqp.options.Publish} [options]
   * @param {(index: number) => void} [via] as `send` has it
   */
  async route (exchange, key, buffer, options, via) {
    await this.#one((channel) => channel.route(exchange, key, buffer, options), { via })
  }

  /**
   * A reply goes back through the shard the message it answers arrived on. Whoever sent that
   * message re-sends what it sent through a shard once the shard is lost, and nothing else, so a
   * reply taking another way could be lost with a shard that nothing is re-sent for. It takes
   * another way when that shard is not reachable, which leaves its message unacknowledged there,
   * to be delivered and answered again.
   *
   * @param {string} queue
   * @param {Buffer} buffer
   * @param {comq.amqp.options.Publish} [options]
   * @param {comq.amqp.Message} [origin] the message this one answers
   * @return {Promise<boolean>}
   */
  async fire (queue, buffer, options, origin) {
    // noinspection  JSValidateTypes
    return await this.#one((channel) => channel.fire(queue, buffer, options), { prefer: origin?.[ARRIVAL] })
  }

  async close () {
    await this.#all((channel) => channel.close())
  }

  get closed () {
    return [...this.#channels].every((channel) => channel.closed)
  }

  async seal () {
    await this.#all((channel) => channel.seal())
  }

  diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  forget (event, listener) {
    this.#diagnostics.off(event, listener)
  }

  /**
   * @param {comq.Connection} connection
   * @param {number} index
   * @return {Promise<void>}
   */
  #create = async (connection, index) => {
    this.#watch(connection, index)

    const pending = connection.createChannel(this.#type, index)
    const channel = await this.#pend(pending, index)

    this.#add(channel)
    this.#pipe(channel)

    channel.diagnose('flow', () => this.#remove((channel)))
    channel.diagnose('drain', () => this.#recover(channel))
    channel.diagnose('recover', () => this.#recover(channel))
  }

  /**
   * Tracks whether a shard is reachable, so that subscribing does not wait for
   * one that is not. The pool itself is left alone: a channel is only benched
   * when it actually fails to publish, otherwise a lost connection would
   * interrupt the streams it is carrying. Losing a shard is reported instead,
   * since a request awaiting its reply on it will never be answered.
   * A connection closed on purpose is not a loss.
   *
   * @param {comq.Connection} connection
   * @param {number} index
   */
  #watch (connection, index) {
    this.#down[index] = new Promex()
    this.#alive[index] = connection.connected !== false

    if (connection.connected === false) this.#down[index].resolve()

    connection.diagnose('close', (error) => {
      this.#alive[index] = false
      this.#down[index].resolve()

      // the channel stays in the pool, yet there is one less shard to publish to
      this.#update()

      if (error !== undefined && connection.closed !== true) {
        this.#diagnostics.emit(LOST, index)
      }
    })

    connection.diagnose('open', () => {
      this.#alive[index] = true
      this.#down[index] = new Promex()

      this.#update()
    })
  }

  /**
   * @param {Promise<comq.Channel>} pending
   * @param {number} index
   * @return {Promise<comq.Channel>}
   */
  async #pend (pending, index) {
    this.#pending.set(pending, index)

    const channel = await pending

    this.#pending.delete(pending)

    return channel
  }

  /**
   * @param {comq.Channel} channel
   */
  #pipe (channel) {
    for (const event of events.channel) {
      if (event === RETURN) continue // returns are retried before being reported
      if (event === LOST) continue // a shard is lost with its connection, not its channel
      if (event === REMOVE) continue // it is the pool that removes a channel, not the channel

      channel.diagnose(event, (...args) => this.#diagnostics.emit(event, ...args, channel.index))
    }

    channel.diagnose(RETURN, (message) => this.#returned(message, channel))
  }

  /**
   * An unroutable message is retried on the shards that have not seen it yet,
   * since a queue may be declared on some of them only. The return is reported
   * once every shard has rejected the message.
   *
   * @param {comq.amqp.Message} message
   * @param {comq.Channel} channel
   */
  #returned (message, channel) {
    const report = () => this.#diagnostics.emit(RETURN, message, channel.index)
    const attempt = (message.properties.headers?.[RETURN_HEADER] ?? 0) + 1
    const rest = this.#pool.filter((one) => one !== channel)
    const { exchange, routingKey } = message.fields

    // a failed message waits on an exchange of comq's own, a fanout that is declared as one
    // where it is consumed, and declaring it on another shard as anything else is refused
    const exhausted = exchange.startsWith(RETRY_PREFIX) ||
      attempt >= this.#connections.length ||
      rest.length === 0

    if (exhausted) return report()

    const properties = {
      ...message.properties,
      mandatory: true,
      headers: { ...message.properties.headers, [RETURN_HEADER]: attempt }
    }

    const next = rest[Math.floor(Math.random() * rest.length)]

    // the message is on that shard now, and is lost with it rather than with this one
    this.#diagnostics.emit(REROUTE, message, next.index)

    // a Request under a key goes through its routed exchange, which `route` declares on that
    // shard before publishing: publishing to an exchange a broker lacks closes the connection
    const retried = exchange === DEFAULT
      ? next.fire(routingKey, message.content, properties)
      : next.route(exchange, routingKey, message.content, properties)

    retried.catch(report)
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

    this.#bench.set(channel, new Promex())
    this.#channels.delete(channel)
    this.#update()
    this.#diagnostics.emit(REMOVE, channel.index)
  }

  /**
   * A shard leaves the pool when it rejects a publish, and stops being reachable
   * when its connection is lost, which the pool is not told about. Both leave
   * `#one` waiting, so both are reported the same way.
   */
  #update () {
    this.#pool = Array.from(this.#channels)

    const paused = this.#reachable().length === 0

    if (paused === this.#paused) return

    this.#paused = paused
    this.#diagnostics.emit(paused ? 'pause' : 'resume')
  }

  /**
   * @param {comq.Channel} channel
   */
  #recover (channel) {
    if (this.#bench.has(channel)) this.#comeback(channel)

    this.#add(channel)

    this.#recovery.resolve()
    this.#recovery = new Promex()
  }

  #comeback (channel) {
    this.#bench.get(channel).resolve(channel)
    this.#bench.delete(channel)
  }

  /**
   * Resolves once every available shard has settled, requiring at least one to
   * succeed. Benched shards are applied when they come back, which must not
   * hold up the caller.
   *
   * @param {(channel: comq.Channel) => void} fn
   * @return {Promise<any>}
   */
  async #every (fn) {
    const promises = []

    for (const channel of this.#channels) {
      promises.push(this.#unless(fn(channel), channel.index))
    }

    for (const [pending, index] of this.#pending) {
      promises.push(this.#unless(pending.then(fn), index))
    }

    for (const recover of this.#bench.values()) recover.then(fn).catch(noop)

    const results = await Promise.allSettled(promises)
    const fulfilled = results.find((result) => result.status === 'fulfilled')

    if (fulfilled === undefined) {
      const reasons = results.map((result) => result.reason)

      throw new AggregateError(reasons, 'No shard is available')
    }

    return fulfilled.value
  }

  /**
   * Gives up on a shard as soon as its connection is lost.
   *
   * @param {Promise<any>} promise
   * @param {number} index
   * @return {Promise<any>}
   */
  async #unless (promise, index) {
    const down = this.#down[index]

    return down === undefined ? await promise : await Promise.race([promise, down])
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
    for (const pending of this.#pending.keys()) promises.push(pending.then(fn))
    for (const recover of this.#bench.values()) promises.push(recover.then(fn))

    return promises
  }

  /**
   * The channels of the shards that are known to be connected.
   * An empty result means every shard is down or benched — wait rather than
   * publish: a destroyed socket accepts a write without complaining.
   *
   * @return {comq.Channel[]}
   */
  #reachable () {
    return this.#pool.filter((channel) => this.#alive[channel.index] !== false)
  }

  /**
   * Publishes through a shard chosen at random, or through the one preferred while it is
   * reachable, and fails over to another when that one fails.
   *
   * @param {(channel: comq.Channel) => void} fn
   * @param {{ via?: (index: number) => void, prefer?: number }} [route]
   */
  async #one (fn, route = {}) {
    // capture before the check: recover may replace `#recovery` in between
    const waiting = this.#recovery
    const pool = this.#reachable()

    if (pool.length === 0) {
      await waiting

      return this.#one(fn, route)
    }

    const channel = pool.find((channel) => channel.index === route.prefer) ??
      pool[Math.floor(Math.random() * pool.length)]

    // told before the publish is awaited: a shard lost while it is under way has it on board
    route.via?.(channel.index)

    try {
      return await fn(channel)
    } catch {
      this.#remove(channel)

      return this.#one(fn, route)
    }
  }
}

/**
 * @param {comq.channels.Consumer} consumer
 * @param {comq.Channel} channel
 * @return {comq.channels.Consumer}
 */
function arrival (consumer, channel) {
  return (message) => {
    message[ARRIVAL] = channel.index

    return consumer(message)
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

const DEFAULT = ''
const RETURN = 'return'
const REMOVE = 'remove'
const RETURN_HEADER = 'x-return'
const LOST = 'lost'

/** A returned message published on another shard, which is where it can be lost from now on. */
const REROUTE = 'reroute'

/** Which shard a consumed message arrived on. */
const ARRIVAL = Symbol('arrival')

function noop () {}

exports.create = create
