'use strict'

const { retry } = require('../retry')
const { resolve, choose } = require('./resolve')

/**
 * Follows what one name resolves to, for everyone in the process who follows it: a name is
 * resolved once however many connections stand on it, and tells each of them when it has
 * changed for good.
 *
 * A change is seldom seen whole. Records are updated one after another, and until their TTL has
 * run out the caches on the way answer with the old address and the new one in turn. So what is
 * observed is a candidate, and it replaces what is in effect only once it has been observed
 * unchanged for the settle time; anything else observed in between starts that time anew.
 */
class Name {
  /** @type {string} */
  #host

  /** @type {comq.shards.Timing} */
  #options

  /** @type {string} what the registry knows it by */
  #key

  /** @type {Set<comq.shards.Follower>} */
  #followers = new Set()

  /** @type {string | undefined} what is in effect */
  #current

  /** @type {string | undefined} what was observed last */
  #candidate

  /** @type {number} when the candidate was first observed as it is */
  #since = 0

  /** @type {number} the longest TTL the name has been answered with, in seconds */
  #ttl = 0

  /** @type {boolean} whether the name was answered without a TTL */
  #untimed = false

  /** @type {Promise<void> | undefined} */
  #starting

  /** @type {ReturnType<setTimeout> | undefined} */
  #timer

  #polling = false
  #poked = false
  #stopped = false

  /**
   * @param {string} host
   * @param {comq.shards.Timing} options
   * @param {string} key
   */
  constructor (host, options, key) {
    this.#host = host
    this.#options = options
    this.#key = key
  }

  /**
   * The name everyone in the process follows `host` by with the same timing: the timing is
   * part of what a name is, so that nobody is followed at a pace they did not ask for.
   *
   * @param {string} host
   * @param {comq.shards.Timing} [options]
   * @return {Name}
   */
  static of (host, options = {}) {
    const key = host + ' ' + JSON.stringify([options.interval, options.settle])
    let name = names.get(key)

    if (name === undefined) {
      name = new Name(host, options, key)
      names.set(key, name)
    }

    return name
  }

  get host () {
    return this.#host
  }

  /** @type {string | undefined} the address in effect, once started */
  get address () {
    return this.#current
  }

  get interval () {
    return this.#options.interval ?? INTERVAL_MS
  }

  /**
   * How long an answer is to hold before it is acted upon. A TTL bounds how long a cache may
   * answer with what is no longer true, and says nothing about records that are being updated
   * one by one, hence the floor.
   */
  get settle () {
    return this.#options.settle ?? this.period
  }

  /** How long what the name was last answered with may be cached. */
  get period () {
    return period(this.#ttl, this.#untimed)
  }

  /**
   * Follows the name until the returned function is called. The last one to stop following
   * it stops it.
   *
   * @param {comq.shards.Follower} follower
   * @return {() => void}
   */
  follow (follower) {
    this.#followers.add(follower)

    return () => {
      this.#followers.delete(follower)

      if (this.#followers.size === 0) this.#stop()
    }
  }

  /**
   * Resolves the name, as many times as it takes: a name that does not resolve is no more a
   * reason to give up than a broker that is not up yet.
   *
   * @return {Promise<string>} the address in effect
   */
  async start () {
    this.#starting ??= this.#begin()

    await this.#starting

    return /** @type {string} */ (this.#current)
  }

  /**
   * Looks now rather than when the interval is up.
   */
  poke () {
    if (this.#stopped || this.#starting === undefined) return

    if (this.#polling) {
      this.#poked = true

      return
    }

    clearTimeout(this.#timer)
    this.#poll().catch(noop)
  }

  async #begin () {
    await retry(async (again) => {
      if (this.#stopped) return

      const address = await this.#observe()

      if (address === undefined) return again

      this.#current = address
      this.#candidate = address
      this.#since = Date.now()
    }, global.COMQ_TESTING_RESOLVE_BACKOFF)

    this.#schedule()
  }

  #stop () {
    this.#stopped = true
    clearTimeout(this.#timer)

    if (names.get(this.#key) === this) names.delete(this.#key)
  }

  #schedule () {
    if (this.#stopped) return

    this.#timer = setTimeout(() => this.#poll().catch(noop), this.interval)
    this.#timer.unref()
  }

  async #poll () {
    this.#polling = true

    try {
      const observed = (await this.#observe()) ?? this.#candidate

      if (!this.#stopped) this.#consider(/** @type {string} */ (observed))
    } finally {
      this.#polling = false
    }

    if (this.#poked) {
      this.#poked = false

      return await this.#poll()
    }

    this.#schedule()
  }

  /**
   * A name whose broker is out of reach for any of those who follow it has nothing to wait for:
   * the connection to a broker is one for the whole process.
   *
   * @param {string} observed
   */
  #consider (observed) {
    const now = Date.now()

    if (observed !== this.#candidate) {
      this.#candidate = observed
      this.#since = now
    }

    if (this.#candidate === this.#current) return

    const settled = now - this.#since >= this.settle

    if (!settled && !this.#urgent()) return

    this.#current = this.#candidate

    for (const follower of this.#followers) follower.change(this.#host, this.#current)
  }

  /**
   * @return {boolean}
   */
  #urgent () {
    for (const follower of this.#followers) if (follower.urgent(this.#host)) return true

    return false
  }

  /**
   * A name that fails to resolve keeps the address it was observed with: a resolver that is
   * briefly out of reach has not said that the name is gone.
   *
   * @return {Promise<string | undefined>} the address the name is observed with, unless it is
   * not known
   */
  async #observe () {
    try {
      const { addresses, ttl } = await resolve(this.#host)

      if (addresses.length === 0) throw new Error(`${this.#host} resolves to no address`)

      if (ttl === undefined) this.#untimed = true
      else this.#ttl = Math.max(this.#ttl, ttl)

      return choose(addresses, this.#current)
    } catch (exception) {
      for (const follower of this.#followers) follower.error(exception)

      return undefined
    }
  }

  // Singletons are evil.
  static __lets_pretend_this_method_doesnt_exist () {
    for (const name of names.values()) name.#stop()
  }
}

/**
 * How long an answer may be cached: the longest TTL seen, and no less than the floor.
 *
 * @param {number} ttl the longest TTL seen, in seconds
 * @param {boolean} untimed whether an answer came without a TTL
 * @return {number}
 */
function period (ttl, untimed) {
  return Math.max(FLOOR_MS, ttl * 1000, untimed ? UNTIMED_MS : 0)
}

/** @type {Map<string, Name>} */
const names = new Map()

const INTERVAL_MS = 300_000

/** No TTL is short enough to act on at once. */
const FLOOR_MS = 900_000

/** What a name answered without a TTL is given. */
const UNTIMED_MS = 1_800_000

function noop () {}

exports.Name = Name
exports.INTERVAL_MS = INTERVAL_MS
exports.FLOOR_MS = FLOOR_MS
