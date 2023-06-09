'use strict'

const { IO } = require('./io')
const { Connection } = require('./connection')
const { SingletonConnection } = require('./singleton')
const shards = require('./shards')

/** @type {comq.connect} */
const connect = async (...urls) => {
  return create(urls, connectionConstructor(Connection))
}

/** @type {comq.connect} */
const assert = async (...urls) => {
  return create(urls, connectionConstructor(SingletonConnection))
}

/**
 * @param {string[]} urls
 * @param {(urls: string[]) => comq.Connection} constructor
 * @return {Promise<IO>}
 */
const create = async (urls, constructor) => {
  const connection = constructor(urls)

  await connection.open()

  return new IO(connection)
}

const connectionConstructor = (ConnectionClass) =>
  /**
   * @param {string[]} urls
   * @return {comq.Connection}
   */
  (urls) => {
    if (urls.length === 1) return new ConnectionClass(urls[0])
    else return shardedConnection(urls, ConnectionClass)
  }

/**
 * @param {string[]} urls
 * @param {function} ConnectionClass
 * @return {comq.Connection}
 */
const shardedConnection = (urls, ConnectionClass) => {
  const connections = urls.map((url) => new ConnectionClass(url))

  return new shards.Connection(connections)
}

exports.connect = connect
exports.assert = assert
