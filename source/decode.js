'use strict'

const decoders = require('./encoders')

/**
 * @param {comq.amqp.Message} message
 * @returns {any}
 */
const decode = (message) => {
  const encoding = message.properties.contentType ?? DEFAULT

  if (encoding === DEFAULT) return message.content
  if (!(encoding in decoders)) throw new Error(`Encoding '${encoding}' is not supported`)

  return decoders[encoding].decode(message.content)
}

const DEFAULT = 'application/octet-stream'

exports.decode = decode
