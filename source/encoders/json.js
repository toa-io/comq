'use strict'

/**
 * @param {any} value
 * @returns {Buffer}
 */
const encode = (value) => {
  if (value === undefined) { return Buffer.alloc(0) }

  const json = JSON.stringify(value)

  return Buffer.from(json)
}

/**
 * @param {Buffer} buffer
 */
const decode = (buffer) => {
  if (buffer.length === 0) { return undefined }

  const json = buffer.toString()

  return JSON.parse(json)
}

exports.encode = encode
exports.decode = decode
