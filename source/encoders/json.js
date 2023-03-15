'use strict'

/**
 * @param {any} value
 * @returns {Buffer}
 */
const encode = (value) => {
  const json = JSON.stringify(value)

  return Buffer.from(json)
}

/**
 * @param {Buffer} buffer
 */
const decode = (buffer) => {
  const json = buffer.toString()

  return JSON.parse(json)
}

exports.encode = encode
exports.decode = decode
