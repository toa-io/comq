'use strict'

const { IO } = require('./io')
const { Connection } = require('./connection')
const { SingletonConnection } = require('./singleton')
const shards = require('./shards')

/** @type {comq.Connect} */
const connect = async (...args) => {
  return create(args, Connection)
}

/** @type {comq.Connect} */
const assert = async (...args) => {
  return create(args, SingletonConnection)
}

/**
 * The urls are variadic, so the overrides are the trailing argument when there is one
 * that is not a url.
 *
 * @param {(string | comq.topology.Overrides)[]} args
 * @return {[string[], comq.topology.Overrides]}
 */
const split = (args) => {
  const last = args[args.length - 1]

  const urls = /** @type {string[]} */ (typeof last === 'object' ? args.slice(0, -1) : args)
  const overrides = /** @type {comq.topology.Overrides} */ (typeof last === 'object' ? last : {})

  return [urls, overrides]
}

/**
 * @param {(string | comq.topology.Overrides)[]} args
 * @param {new (url: string, overrides: comq.topology.Overrides) => comq.Connection} ConnectionClass
 * @return {Promise<IO>}
 */
const create = async (args, ConnectionClass) => {
  const [urls, overrides] = split(args)
  const connection = connectionOf(urls, overrides, ConnectionClass)

  await connection.open()

  return new IO(connection)
}

/**
 * @param {string[]} urls
 * @param {comq.topology.Overrides} overrides
 * @param {Function} ConnectionClass
 * @return {comq.Connection}
 */
const connectionOf = (urls, overrides, ConnectionClass) => {
  const connections = urls.map((url) => new ConnectionClass(url, overrides))

  if (connections.length === 1) return connections[0]

  return new shards.Connection(connections)
}

exports.connect = connect
exports.assert = assert
