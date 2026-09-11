'use strict'

/**
 * A Request the broker returned instead of routing: nothing was bound under its key, so it
 * reached no one and did not run.
 */
class Unroutable extends Error {
  /** @type {string} */
  exchange

  /** @type {string} */
  key

  /**
   * @param {string} exchange
   * @param {string} key
   */
  constructor (exchange, key) {
    super(`Nothing is bound to '${exchange}' under '${key}'`)

    this.name = 'Unroutable'
    this.exchange = exchange
    this.key = key
  }
}

exports.Unroutable = Unroutable
