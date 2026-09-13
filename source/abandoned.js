'use strict'

/**
 * A Reply nobody is waiting for any more, or a Request made once the waiting has stopped. The
 * Request itself was sent and may well be processed; what was given up is the answer.
 */
class Abandoned extends Error {
  constructor () {
    super('The connection no longer waits for a Reply')

    this.name = 'Abandoned'
  }
}

exports.Abandoned = Abandoned
