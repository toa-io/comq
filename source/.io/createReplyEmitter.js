'use strict'

const { randomBytes } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { concat } = require('./concat')

/**
 * @param {string} label
 * @returns {comq.ReplyEmitter}
 */
function createReplyEmitter (label) {
  const id = randomBytes(8).toString('hex')
  const queue = concat(label, id)
  const emitter = new EventEmitter()

  emitter.setMaxListeners(0)
  emitter.queue = queue

  return /** @type {comq.ReplyEmitter} */ emitter
}

exports.createReplyEmitter = createReplyEmitter
