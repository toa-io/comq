'use strict'

const { Connection } = require('./connection')

class SingletonConnection extends Connection {
  /** @type {string} */
  #url

  /** @type {Promise<void>} */
  #opened = null

  /** @type {comq.topology.Overrides} */
  #overrides

  /**
   * An instance is shared, so its topology is whatever the first caller asked for.
   * A later caller asking for something else would get a connection retrying on a
   * ladder it did not choose, which is expensive to debug and cheap to refuse.
   *
   * @param {string} url
   * @param {comq.topology.Overrides} [overrides]
   */
  constructor (url, overrides = {}) {
    const instance = instances.get(url)

    if (instance !== undefined) {
      if (!same(instance.#overrides, overrides)) {
        throw new Error(`Connection to ${url} has already been asserted with a different topology`)
      }

      return instance
    }

    super(url, overrides)

    this.#url = url
    this.#overrides = overrides

    instances.set(url, this)
  }

  async open () {
    increment(this.#url)

    if (this.#opened === null) this.#opened = super.open()

    await this.#opened
  }

  async close () {
    const remainder = decrement(this.#url)

    if (remainder === 0) await this.#close()
  }

  async #close () {
    this.#opened = null
    await super.close()
  }

  // Singletons are evil.
  static __lets_pretend_this_method_doesnt_exist () {
    instances.clear()
    counters.clear()
  }
}

function increment (url) {
  const value = (counters.get(url) ?? 0) + 1

  counters.set(url, value)
}

function decrement (url) {
  const value = counters.get(url) - 1

  counters.set(url, value)

  return value
}

/** @type {Map<string, SingletonConnection>} */
const instances = new Map()

/** @type {Map<string, number>} */
const counters = new Map()

/**
 * Topology overrides are a couple of small plain objects, so this is enough and
 * does not pull in a dependency for it.
 *
 * @param {object} one
 * @param {object} another
 * @returns {boolean}
 */
function same (one, another) {
  return JSON.stringify(sorted(one)) === JSON.stringify(sorted(another))
}

/**
 * @param {any} value
 * @returns {any} the value with every object's keys in a stable order
 */
function sorted (value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
}

exports.SingletonConnection = SingletonConnection
