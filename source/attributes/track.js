'use strict'

function track (context, method = undefined) {
  if (method === undefined) return promises(context)

  context[KEY] ??= new Set()

  const tracking = context[KEY]

  return async function (...args) {
    const promise = method.apply(this, args)

    tracking.add(promise)
    promise.catch(noop).finally(() => tracking.delete(promise))

    return promise
  }
}

function promises (context) {
  if (context[KEY] === undefined) return

  const promises = context[KEY]

  return Promise.all(promises)
}

const KEY = Symbol('context tracking key')

const noop = () => undefined

exports.track = track
