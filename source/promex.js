'use strict'

/**
 * A promise settled by whoever holds it, rather than only from within its executor.
 * `callback` settles it the way node-style callbacks report: an error, or a value.
 *
 * @template T
 * @extends {Promise<T>}
 */
class Promex extends Promise {
  /** @type {(value?: T | PromiseLike<T>) => void} */
  resolve

  /** @type {(reason?: any) => void} */
  reject

  /**
   * @param {(resolve: (value?: any) => void, reject: (reason?: any) => void) => void} [executor]
   */
  constructor (executor = noop) {
    let ok
    let oh

    super((resolve, reject) => {
      ok = resolve
      oh = reject

      return executor(resolve, reject)
    })

    this.resolve = ok
    this.reject = oh
  }

  /**
   * @param {any} error
   * @param {T} [value]
   */
  callback = (error, value) => {
    if (error !== null && error !== undefined) this.reject(error)
    else this.resolve(value)
  }
}

function noop () {}

exports.Promex = Promex
