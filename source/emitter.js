'use strict'

const { EventEmitter } = require('node:events')

function create () {
  const emitter = new EventEmitter()

  emitter.setMaxListeners(10000)

  return emitter
}

exports.create = create
