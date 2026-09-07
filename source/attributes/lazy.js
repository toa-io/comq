'use strict'

/**
 * Runs the initializers once per distinct set of arguments before the method.
 *
 * The record of what has been initialized is kept per context, so that a context
 * that is dropped takes its record with it, and it is looked up by argument rather
 * than scanned — a channel publishing to a thousand queues asks for the thousandth
 * as fast as for the first.
 *
 * @param {object} context
 * @param {Function | Function[]} initializers
 * @param {(...args: unknown[]) => Promise<unknown>} method
 */
function lazy (context, initializers, method) {
  if (!Array.isArray(initializers)) initializers = [initializers]

  return async function (...args) {
    const override = await call(context, initializers, args)

    if (override !== undefined) args.splice(0, override.length, ...override)

    return method.apply(this, args)
  }
}

/**
 * @param {object} context
 * @param {Function[]} initializers
 * @param {any[]} args
 * @returns {Promise<any[]>}
 */
async function call (context, initializers, args) {
  let override

  for (const init of initializers) {
    const result = await lock(context, init, args)

    if (result !== undefined) override = result
  }

  return override
}

/**
 * An initializer expecting N arguments is run once per distinct N leading
 * arguments, which are the keys of a trie of Maps N levels deep.
 *
 * @param {object} context
 * @param {(...args: unknown[]) => Promise<unknown>} init
 * @param {unknown[]} args
 * @returns {Promise<unknown>}
 */
function lock (context, init, args) {
  const arity = init.length

  let node = table(context, init)

  for (let i = 0; i < arity - 1; i++) node = branch(node, args[i])

  const key = arity === 0 ? NONE : args[arity - 1]
  const found = node.get(key)

  if (found !== undefined) return found

  const promise = init.apply(context, args.slice(0, arity))

  node.set(key, promise)

  return promise
}

/**
 * @param {object} context
 * @param {Function} init
 * @return {Map<unknown, unknown>}
 */
function table (context, init) {
  let tables = TABLES.get(context)

  if (tables === undefined) {
    tables = new Map()
    TABLES.set(context, tables)
  }

  return branch(tables, init)
}

/**
 * @param {Map<unknown, unknown>} node
 * @param {unknown} key
 * @return {Map<unknown, unknown>}
 */
function branch (node, key) {
  let next = node.get(key)

  if (next === undefined) {
    next = new Map()
    node.set(key, next)
  }

  return /** @type {Map<unknown, unknown>} */ next
}

/**
 * @param {object} context
 */
function reset (context) {
  TABLES.delete(context)
}

/** @type {WeakMap<object, Map<Function, Map<unknown, unknown>>>} */
const TABLES = new WeakMap()

const NONE = Symbol('no arguments')

lazy.reset = reset

exports.lazy = lazy
