'use strict'

const { concat } = require('./concat')
const {
  createReplyEmitter,
  ReplyStream,
  pipe,
  streamCorrelationId,
  streamControlCorrelationId
} = require('./replies')

exports.concat = concat
exports.createReplyEmitter = createReplyEmitter
exports.ReplyStream = ReplyStream
exports.pipe = pipe
exports.streamCorrelationId = streamCorrelationId
exports.streamControlCorrelationId = streamControlCorrelationId
