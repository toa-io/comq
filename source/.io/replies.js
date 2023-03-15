'use strict'

const { randomBytes } = require('node:crypto')
const { EventEmitter } = require('node:events')

const { concat } = require('./concat')

/**
 * @param {string} label
 * @returns {comq.ReplyEmitter}
 */
const createReplyEmitter = (label) => {
  const id = randomBytes(8).toString('hex')
  const queue = concat(label, id)
  const emitter = new EventEmitter()
  const once = (name, callback) => emitter.once(name, callback)
  const emit = (name, value) => emitter.emit(name, value)
  const clear = () => emitter.removeAllListeners()

  emitter.setMaxListeners(0)

  return { queue, once, emit, clear }
}

exports.createReplyEmitter = createReplyEmitter
