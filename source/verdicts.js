'use strict'

/**
 * How a consumer says what should happen to a message it could not handle.
 *
 * The brand is a registered symbol rather than the class identity: comq is a library,
 * and a dependency that pins it while the application resolves its own tree makes two
 * copies of it the ordinary outcome. `instanceof` is silently `false` across those,
 * which would read a `Park` as an unclassified rejection and retry it to exhaustion
 * before parking it anyway. The global symbol registry is shared; a class is not.
 */
const VERDICT = Symbol.for('comq.verdict')

const RETRY = 'retry'
const PARK = 'park'

/**
 * Whatever the consumer needed was briefly not there. This is what an unclassified
 * rejection already means, so throwing it changes nothing but the reader's certainty.
 */
class Retry extends Error {
  [VERDICT] = RETRY

  name = 'Retry'
}

/**
 * This consumer will never process this message, however many times it is handed over.
 * The message is kept rather than retried.
 */
class Park extends Error {
  [VERDICT] = PARK

  name = 'Park'
}

/**
 * A rejection nobody classified is a rejection nobody chose: it means Retry.
 *
 * @param {any} exception
 * @returns {'retry' | 'park'}
 */
const verdictOf = (exception) => {
  const verdict = exception?.[VERDICT]

  return verdict === PARK || verdict === RETRY ? verdict : RETRY
}

exports.Retry = Retry
exports.Park = Park
exports.verdictOf = verdictOf
exports.VERDICT = VERDICT
exports.RETRY = RETRY
exports.PARK = PARK
