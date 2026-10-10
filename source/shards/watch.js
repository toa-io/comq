'use strict'

const { retry } = require('../retry')
const emitter = require('../emitter')
const { resolve, choose } = require('./resolve')

/**
 * Watches what a set of names resolve to, and tells once it has changed for good.
 *
 * A change is seldom seen whole. Records are updated one after another, and until their TTL has
 * run out the caches on the way answer with the old address and the new one in turn. So what is
 * observed is a candidate, and it replaces what is in effect only once it has been observed
 * unchanged for the settle time; anything else observed in between starts that time anew.
 */
class Watch {
  /** @type {string[]} */
  #hosts

  /** @type {comq.shards.Timing} */
  #options

  /** @type {(host: string) => boolean} */
  #urgent

  /** @type {Map<string, string>} what is in effect */
  #current = new Map()

  /** @type {Map<string, string>} what was observed last */
  #candidate = new Map()

  /** @type {number} when the candidate was first observed as it is */
  #since = 0

  /** @type {number} the longest TTL any name has been answered with, in seconds */
  #ttl = 0

  /** @type {boolean} whether a name was answered without a TTL */
  #untimed = false

  /** @type {ReturnType<setTimeout> | undefined} */
  #timer

  #polling = false
  #poked = false
  #stopped = false

  #events = emitter.create()

  /**
   * @param {string[]} hosts
   * @param {comq.shards.Timing} [options]
   * @param {(host: string) => boolean} [urgent] whether a name is of no use as it is resolved
   * now, so that what it resolves to next is taken at once
   */
  constructor (hosts, options = {}, urgent = () => false) {
    this.#hosts = Array.from(new Set(hosts))
    this.#options = options
    this.#urgent = urgent
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
    return this.#options.settle ?? this.#period()
  }

  /** How long a broker no name points at is to stay idle before it is left. */
  get linger () {
    return this.#options.linger ?? this.#period()
  }

  /**
   * Resolves every name, as many times as it takes: a name that does not resolve is no more a
   * reason to give up than a broker that is not up yet.
   *
   * @return {Promise<Map<string, string>>} the address of each name
   */
  async start () {
    this.#stopped = false

    await retry(async (again) => {
      if (this.#stopped) return

      const [observed, failed] = await this.#observe()

      if (failed) return again

      this.#current = observed
      this.#candidate = observed
      this.#since = Date.now()
    }, global.COMQ_TESTING_RESOLVE_BACKOFF)

    this.#schedule()

    return new Map(this.#current)
  }

  stop () {
    this.#stopped = true

    clearTimeout(this.#timer)
  }

  /**
   * Looks now rather than when the interval is up.
   */
  poke () {
    if (this.#stopped) return

    if (this.#polling) {
      this.#poked = true

      return
    }

    clearTimeout(this.#timer)

    this.#poll().catch(noop)
  }

  /**
   * @param {'change' | 'error'} event
   * @param {Function} listener
   */
  on (event, listener) {
    this.#events.on(event, listener)
  }

  #schedule () {
    if (this.#stopped || this.#hosts.length === 0) return

    this.#timer = setTimeout(() => this.#poll().catch(noop), this.interval)
    this.#timer.unref()
  }

  async #poll () {
    this.#polling = true

    try {
      const [observed] = await this.#observe()

      if (!this.#stopped) this.#consider(observed)
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
   * @param {Map<string, string>} observed
   */
  #consider (observed) {
    const now = Date.now()

    if (!same(observed, this.#candidate)) {
      this.#candidate = observed
      this.#since = now
    }

    const settled = now - this.#since >= this.settle

    let changed = false

    for (const [host, address] of this.#candidate) {
      if (address === this.#current.get(host)) continue
      if (!settled && !this.#urgent(host)) continue

      this.#current.set(host, address)

      changed = true
    }

    if (changed) this.#events.emit('change', new Map(this.#current))
  }

  /**
   * A name that fails to resolve keeps the address it was observed with: a resolver that is
   * briefly out of reach has not said that the name is gone.
   *
   * @return {Promise<[Map<string, string>, boolean]>} the address of each name, and whether any
   * of them is not known
   */
  async #observe () {
    const observed = new Map()

    let failed = false

    await Promise.all(this.#hosts.map(async (host) => {
      try {
        const { addresses, ttl } = await resolve(host)

        if (addresses.length === 0) throw new Error(`${host} resolves to no address`)

        if (ttl === undefined) this.#untimed = true
        else this.#ttl = Math.max(this.#ttl, ttl)

        observed.set(host, choose(addresses, this.#current.get(host)))
      } catch (exception) {
        this.#events.emit('error', exception)

        if (this.#candidate.has(host)) observed.set(host, this.#candidate.get(host))
        else failed = true
      }
    }))

    return [observed, failed]
  }

  /**
   * A cache answers with the time its record has left, so the longest ever seen is the closest
   * to what the record was published with.
   *
   * @return {number}
   */
  #period () {
    return Math.max(FLOOR_MS, this.#ttl * 1000, this.#untimed ? UNTIMED_MS : 0)
  }
}

/**
 * @param {Map<string, string>} one
 * @param {Map<string, string>} another
 * @return {boolean}
 */
function same (one, another) {
  if (one.size !== another.size) return false

  for (const [host, address] of one) if (another.get(host) !== address) return false

  return true
}

const INTERVAL_MS = 10_000

/** No TTL is short enough to act on at once. */
const FLOOR_MS = 30_000

/** What a name answered without a TTL is given. */
const UNTIMED_MS = 60_000

function noop () {}

exports.Watch = Watch
