'use strict'

const events = require('../events')
const channel = require('./channel')
const emitter = require('../emitter')
const { Name, INTERVAL_MS, FLOOR_MS } = require('./name')
const { hostOf, locate } = require('./resolve')

/**
 * The URLs it is given are virtual shards: names, of which several may stand for one broker.
 * A connection is made to each broker rather than to each name, and the brokers are followed
 * as the names move from one to another.
 *
 * A broker is joined before another is retired, and a retired one is left only once it has
 * nothing more to give: see `#reconcile` and `#idle`.
 *
 * @implements {comq.Connection}
 */
class Connection {
  /** @type {string[]} */
  #urls

  /** @type {(url: string, servername?: string) => comq.Connection} */
  #create

  /** @type {string[]} the names the URLs are of */
  #hosts

  /** @type {comq.shards.Timing} */
  #timing

  /** @type {Name[]} the names followed while open */
  #names = []

  /** @type {Array<() => void>} what stops following each of them */
  #leaving = []

  /** @type {Map<string, string>} the address of each name */
  #addresses = new Map()

  /** @type {Map<string, comq.shards.Location>} the brokers the names stand for, by URL */
  #wanted = new Map()

  /** @type {Map<number, comq.shards.Shard>} */
  #shards = new Map()

  /** @type {number} the number the next shard gets: one is never given twice */
  #next = 0

  /** @type {Set<string>} the brokers that failed to join, asked again only once an interval is up */
  #refused = new Set()

  /** @type {Set<comq.Channel>} */
  #channels = new Set()

  /** @type {ReturnType<setTimeout> | undefined} */
  #inspection

  #opened = false
  #closed = false

  #diagnostics = emitter.create()

  /**
   * @param {string[]} urls
   * @param {(url: string, servername?: string) => comq.Connection} create
   * @param {comq.shards.Timing} [timing]
   */
  constructor (urls, create, timing) {
    this.#urls = urls
    this.#create = create

    this.#hosts = Array.from(new Set(urls.map(hostOf).filter((host) => host !== undefined)))
    this.#timing = timing ?? {}
  }

  async open () {
    this.#closed = false

    const addresses = await this.#start()

    if (this.#closed) return

    this.#addresses = addresses
    this.#wanted = this.#locations(addresses)

    const shards = Array.from(this.#wanted.values(), (location) => this.#shard(location))
    const openings = shards.map((shard) => shard.connection.open())

    try {
      await Promise.all(openings)
    } catch (exception) {
      await this.#cancel(openings, shards, exception)
    }

    for (const shard of shards) shard.state = ACTIVE

    this.#opened = true

    // the names may have moved while the connections were being made
    this.#reconcile()
  }

  async close () {
    this.#closed = true
    this.#opened = false
    this.#unfollow()

    clearTimeout(this.#inspection)

    const closing = Array.from(this.#shards.values(), (shard) => shard.connection.close())

    await Promise.all(closing)
  }

  async createChannel (type) {
    const members = this.#members()
    const created = await channel.create(members, type)

    this.#channels.add(created)

    // what left, joined or retired while the channel was being made
    for (const index of members.keys()) {
      if (this.#member(this.#shards.get(index)) === false) await created.leave(index)
    }

    for (const shard of this.#shards.values()) {
      if (!this.#member(shard)) continue

      created.join(shard.connection, shard.index).catch(noop)

      if (shard.state === RETIRING) created.retire(shard.index)
    }

    return created
  }

  async diagnose (event, listener) {
    this.#diagnostics.on(event, listener)
  }

  forget (event, listener) {
    this.#diagnostics.off(event, listener)
  }

  /**
   * @return {Map<number, comq.Connection>} the connections a channel is made over
   */
  #members () {
    const members = new Map()

    for (const shard of this.#shards.values()) {
      if (this.#member(shard)) members.set(shard.index, shard.connection)
    }

    return members
  }

  /**
   * @param {comq.shards.Shard} [shard]
   * @return {boolean} whether channels are made over a shard
   */
  #member (shard) {
    return shard !== undefined && shard.joined && shard.state !== LEAVING
  }

  /**
   * @param {Map<string, string>} addresses the address of each name
   * @return {Map<string, comq.shards.Location>}
   */
  #locations (addresses) {
    const locations = new Map()

    for (const url of this.#urls) {
      const location = locate(url, addresses.get(hostOf(url)))

      // the first of the names of a broker is the one it is verified by
      if (!locations.has(location.url)) locations.set(location.url, location)
    }

    return locations
  }

  /**
   * @param {comq.shards.Location} location
   * @return {comq.shards.Shard}
   */
  #shard (location) {
    const index = this.#next++
    const connection = this.#create(location.url, location.servername)

    /** @type {comq.shards.Shard} */
    const shard = { ...location, index, connection, state: JOINING, joined: true, since: 0, listeners: [] }

    for (const event of events.connection) {
      const listener = (...args) => this.#diagnostics.emit(event, ...args, index)

      connection.diagnose(event, listener)
      shard.listeners.push([event, listener])
    }

    // a connection that is lost may be so because its broker has moved
    const lost = (error) => { if (error !== undefined) this.#poke(shard.address) }

    connection.diagnose('close', lost)
    shard.listeners.push(['close', lost])

    this.#shards.set(index, shard)

    return shard
  }

  /**
   * @param {comq.shards.Shard} shard
   */
  #dismiss (shard) {
    for (const [event, listener] of shard.listeners) shard.connection.forget(event, listener)

    this.#shards.delete(shard.index)
  }

  /**
   * @param {string} url
   * @return {comq.shards.Shard | undefined} the shard of a broker, be it on its way out
   */
  #shardOf (url) {
    for (const shard of this.#shards.values()) if (shard.url === url) return shard
  }

  /**
   * A name whose broker is out of reach has nothing to wait for: there is nothing to be had
   * from that broker meanwhile, and a broker that has come back under another address is
   * found at once, as it is when a connection is restored by name.
   *
   * @param {string} host
   * @return {boolean}
   */
  #urgent = (host) => {
    const address = this.#addresses.get(host)

    for (const url of this.#urls) {
      if (hostOf(url) !== host) continue

      const shard = this.#shardOf(locate(url, address).url)

      if (shard?.connection.connected === false) return true
    }

    return false
  }

  /**
   * Follows the names, each of which is shared with whoever else in the process follows it.
   *
   * @return {Promise<Map<string, string>>} the address of each name
   */
  async #start () {
    this.#unfollow()

    const follower = { change: this.#follow, error: this.#error, urgent: this.#urgent }

    this.#names = this.#hosts.map((host) => Name.of(host, this.#timing))
    this.#leaving = this.#names.map((name) => name.follow(follower))

    await Promise.all(this.#names.map((name) => name.start()))

    // a name followed by others may have moved while the rest were being resolved
    return new Map(this.#names.map((name) => [name.host, /** @type {string} */ (name.address)]))
  }

  #unfollow () {
    for (const leave of this.#leaving) leave()

    this.#names = []
    this.#leaving = []
  }

  /**
   * Looks now at the names that stand for a broker.
   *
   * @param {string | undefined} address
   */
  #poke (address) {
    for (const name of this.#names) {
      if (this.#addresses.get(name.host) === address) name.poke()
    }
  }

  /**
   * @param {string} host
   * @param {string} address
   */
  #follow = (host, address) => {
    if (this.#addresses.get(host) === address) return

    this.#addresses.set(host, address)
    this.#wanted = this.#locations(this.#addresses)
    this.#reconcile()
  }

  /**
   * @param {Error} exception
   */
  #error = (exception) => {
    this.#diagnostics.emit('error', exception)
  }

  /** How often the shards are looked at again. */
  get #interval () {
    return this.#timing.interval ?? INTERVAL_MS
  }

  /**
   * How long a retired broker is to stay idle before it is left: as long as any of the names
   * may be cached for, unless told.
   */
  get #linger () {
    return this.#timing.linger ?? Math.max(FLOOR_MS, ...this.#names.map((name) => name.period))
  }

  /**
   * Brings the shards in line with the brokers the names stand for, making before breaking:
   * nothing is retired until every broker that is named has joined, so a name that points at
   * a broker that is not there yet takes nothing away.
   */
  #reconcile () {
    if (!this.#opened || this.#closed) return

    let made = true

    for (const [url, location] of this.#wanted) {
      if (this.#shardOf(url) !== undefined) continue

      // one that is being left is joined anew once it has been
      if (this.#refused.has(url)) made = false
      else this.#join(location).catch(noop)
    }

    for (const shard of this.#shards.values()) {
      const named = this.#wanted.has(shard.url)

      if (named && shard.state === RETIRING) this.#restore(shard)
      if (!named && shard.state === JOINING) this.#leave(shard).catch(noop)
      if (named && shard.state !== ACTIVE) made = false
    }

    if (!made) return

    for (const shard of this.#shards.values()) {
      if (!this.#wanted.has(shard.url) && shard.state === ACTIVE) this.#retire(shard)
    }
  }

  /**
   * @param {comq.shards.Location} location
   * @return {Promise<void>}
   */
  async #join (location) {
    const shard = this.#shard(location)

    shard.joined = false

    try {
      await shard.connection.open()
    } catch (exception) {
      // a broker that refuses is asked again, as its name keeps pointing at it
      this.#diagnostics.emit('error', exception, shard.index)
      this.#dismiss(shard)

      return this.#defer(location.url)
    }

    if (shard.state !== JOINING) return

    // a channel made from now on takes the shard in by itself
    shard.joined = true

    const joining = Array.from(this.#channels,
      (channel) => channel.join(shard.connection, shard.index))

    const results = await Promise.allSettled(joining)
    const failures = results.filter((result) => result.status === 'rejected')

    for (const failure of failures) this.#diagnostics.emit('error', failure.reason, shard.index)

    if (shard.state !== JOINING) return

    // a broker that cannot be consumed from has not joined: taken for one that has, it would
    // let the broker that is consumed from be retired
    if (failures.length > 0) return await this.#leave(shard, true)

    shard.state = ACTIVE

    this.#diagnostics.emit(JOIN, shard.index, shard.address)
    this.#reconcile()
  }

  /**
   * @param {comq.shards.Shard} shard
   */
  #retire (shard) {
    shard.state = RETIRING
    shard.since = Date.now()
    shard.down = undefined

    for (const channel of this.#channels) channel.retire(shard.index)

    this.#diagnostics.emit(RETIRE, shard.index, shard.address)
    this.#inspect()
  }

  /**
   * @param {comq.shards.Shard} shard
   */
  #restore (shard) {
    shard.state = ACTIVE

    for (const channel of this.#channels) channel.restore(shard.index)

    this.#diagnostics.emit(JOIN, shard.index, shard.address)
  }

  /**
   * @param {comq.shards.Shard} shard
   * @param {boolean} [failed] whether it is let go for having failed to join, which is tried
   * again later rather than at once
   * @return {Promise<void>}
   */
  async #leave (shard, failed = false) {
    const retired = shard.state === RETIRING

    shard.state = LEAVING

    const leaving = Array.from(this.#channels, (channel) => channel.leave(shard.index))

    await Promise.allSettled(leaving)
    await shard.connection.close()

    this.#dismiss(shard)

    // one that never joined is not said to have left
    if (retired) this.#diagnostics.emit(LEAVE, shard.index, shard.address)

    if (failed) this.#defer(shard.url)
    else this.#reconcile()
  }

  /**
   * Asks a broker that failed to join again once an interval is up, rather than whenever
   * another name moves meanwhile.
   *
   * @param {string} url
   */
  #defer (url) {
    this.#refused.add(url)

    this.#later(() => {
      this.#refused.delete(url)
      this.#reconcile()
    })
  }

  /**
   * Looks at the retiring shards for as long as there are any.
   */
  #inspect () {
    clearTimeout(this.#inspection)

    this.#inspection = this.#later(async () => {
      for (const shard of Array.from(this.#shards.values())) {
        if (shard.state !== RETIRING) continue

        const idle = await this.#idle(shard)

        // it may have been named again meanwhile
        if (idle && shard.state === RETIRING && !this.#closed) this.#leave(shard).catch(noop)
      }

      for (const shard of this.#shards.values()) if (shard.state === RETIRING) return this.#inspect()
    })
  }

  /**
   * A retiring shard is left once it has had nothing to do for the linger time, counted from
   * the moment it was retired: what is published to its broker by those who have not seen the
   * names move yet is consumed meanwhile. One that is out of reach for that long is given up on.
   *
   * @param {comq.shards.Shard} shard
   * @return {Promise<boolean>}
   */
  async #idle (shard) {
    const now = Date.now()
    const linger = this.#linger

    if (shard.connection.connected === false) {
      shard.down ??= now

      return now - shard.down >= linger
    }

    shard.down = undefined

    const asked = Array.from(this.#channels, (channel) => channel.quiet(shard.index))
    const quiet = await Promise.all(asked)

    return now - Math.max(shard.since, ...quiet) >= linger
  }

  /**
   * @param {() => any} fn
   * @return {ReturnType<setTimeout>}
   */
  #later (fn) {
    const timer = setTimeout(() => Promise.resolve().then(fn).catch(noop), this.#interval)

    timer.unref()

    return timer
  }

  /**
   * @param {Promise<any>[]} openings
   * @param {comq.shards.Shard[]} shards
   * @param {Error} exception
   */
  async #cancel (openings, shards, exception) {
    this.#unfollow()

    const settled = await Promise.allSettled(openings)
    const opened = shards.filter((_, index) => settled[index].status === 'fulfilled')
    const closings = opened.map((shard) => shard.connection.close())

    await Promise.all(closings)

    for (const shard of shards) this.#dismiss(shard)

    throw exception
  }
}

const JOINING = 'joining'
const ACTIVE = 'active'
const RETIRING = 'retiring'
const LEAVING = 'leaving'

const JOIN = 'join'
const RETIRE = 'retire'
const LEAVE = 'leave'

function noop () {}

exports.Connection = Connection
