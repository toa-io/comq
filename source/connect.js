'use strict'

const { IO } = require('./io')
const { Connection } = require('./connection')
const shards = require('./shards')

/** @type {comq.connect} */
const connect = async (...urls) => {
  const connection = create(urls)

  await connection.open()

  return new IO(connection)
}

/**
 * @param {string[]} urls
 * @return {comq.Connection}
 */
const create = (urls) => {
  if (urls.length === 1) return single(urls[0])
  else return sharded(urls)
}

/**
 * @param {string} url
 * @return {comq.Connection}
 */
const single = (url) => new Connection(url)

/**
 * @param {string[]} urls
 * @return {comq.Connection}
 */
const sharded = (urls) => {
  const connections = urls.map(single)

  return new shards.Connection(connections)
}

exports.connect = connect
