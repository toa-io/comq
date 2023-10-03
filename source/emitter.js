'use strict'

const { EventEmitter } = require('node:events')

function create () {
  const emitter = new EventEmitter()

  emitter.setMaxListeners(0)

  return emitter
}

exports.create = create
