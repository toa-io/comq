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
 * The urls are variadic, so the options are the trailing argument when there is one
 * that is not a url: the topology overrides, and how the names are followed.
 *
 * @param {(string | comq.Options)[]} args
 * @return {[string[], comq.topology.Overrides, comq.shards.Timing | undefined]}
 */
const split = (args) => {
  const last = args[args.length - 1]

  const urls = /** @type {string[]} */ (typeof last === 'object' ? args.slice(0, -1) : args)
  const { resolution, ...overrides } = /** @type {comq.Options} */ (typeof last === 'object' ? last : {})

  return [urls.flatMap(shards.expand), overrides, resolution]
}

/**
 * @param {(string | comq.Options)[]} args
 * @param {new (url: string, overrides: comq.topology.Overrides, servername?: string) => comq.Connection} ConnectionClass
 * @return {Promise<IO>}
 */
const create = async (args, ConnectionClass) => {
  const [urls, overrides, resolution] = split(args)
  const connection = connectionOf(urls, overrides, resolution, ConnectionClass)

  await connection.open()

  return new IO(connection)
}

/**
 * Several URLs are the names of the shards, which may be fewer than the names: a connection
 * is made to each broker they stand for. A single URL is connected by its name, as it is.
 *
 * @param {string[]} urls
 * @param {comq.topology.Overrides} overrides
 * @param {comq.shards.Timing | undefined} resolution
 * @param {Function} ConnectionClass
 * @return {comq.Connection}
 */
const connectionOf = (urls, overrides, resolution, ConnectionClass) => {
  if (urls.length === 1) return new ConnectionClass(urls[0], overrides)

  return new shards.Connection(urls,
    (url, servername) => new ConnectionClass(url, overrides, servername), resolution)
}

exports.connect = connect
exports.assert = assert
