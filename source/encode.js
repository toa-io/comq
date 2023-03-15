'use strict'

const encoders = require('./encoders')

/**
 * @param {any} payload
 * @param {comq.encoding} encoding
 * @returns {Buffer}
 */
const encode = (payload, encoding) => {
  if (!(encoding in encoders)) throw new Error(`Encoding '${encoding}' is not supported`)

  return encoders[encoding].encode(payload)
}

exports.encode = encode
