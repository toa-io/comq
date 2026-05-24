'use strict'

/**
 * @param {(...args: any[]) => any} fn
 * @returns {(...args: any[]) => any}
 */
function memo (fn) {
  return (...args) => {
    if (fn[MEMO] === undefined) fn[MEMO] = fn(...args)

    return fn[MEMO]
  }
}

const MEMO = Symbol('memo')

exports.memo = memo
