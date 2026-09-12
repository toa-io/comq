'use strict'

/**
 * A Reply stream that ended before its producer did: what was received is a prefix of what was
 * yielded, and the rest is not coming. A stream that completes ends instead, so that the two
 * cannot be taken for one another.
 */
class Interrupted extends Error {
  /** @type {string} */
  reason

  /**
   * @param {string} reason
   */
  constructor (reason) {
    super(`Reply stream has been interrupted: ${reason}`)

    this.name = 'Interrupted'
    this.reason = reason
  }
}

exports.Interrupted = Interrupted
