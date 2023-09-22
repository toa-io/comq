'use strict'

const { concat } = require('./concat')
const { createReplyEmitter } = require('./createReplyEmitter')
const replies = require('./replies')

exports.concat = concat
exports.replies = replies
exports.createReplyEmitter = createReplyEmitter
