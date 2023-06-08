'use strict'

const { Connection } = require('./connection')

class SingletonConnection extends Connection {
  /** @type {string} */
  #url

  /** @type {Promise<void>} */
  #opened = null

  constructor (url) {
    if (instances.has(url)) return instances.get(url)

    super(url)

    this.#url = url

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

exports.SingletonConnection = SingletonConnection
