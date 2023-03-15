'use strict'

const { IO } = require('./io')
const { Connection } = require('./connection')

/** @type {comq.connect} */
const connect = async (url) => {
  const connection = new Connection(url)

  await connection.open()

  return new IO(connection)
}

exports.connect = connect
