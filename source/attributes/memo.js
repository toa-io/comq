'use strict'

function memo (fn) {
  return (...args) => {
    if (fn[MEMO] === undefined) fn[MEMO] = fn(...args)

    return fn[MEMO]
  }
}

const MEMO = Symbol('memo')

exports.memo = memo
