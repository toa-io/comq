'use strict'

const { EventEmitter } = require('node:events')

/**
 * A listener must not be able to break what it observes: an exception thrown by
 * one used to leave the reconnection it was reporting on unfinished, or take the
 * process down through the emitter amqplib was calling.
 */
class Emitter extends EventEmitter {
  emit (event, ...args) {
    // raw listeners are used so that `once` still removes itself
    const listeners = this.rawListeners(event)

    for (const listener of listeners) {
      try {
        listener.apply(this, args)
      } catch {
        // a diagnostic listener has no one to report to
      }
    }

    return listeners.length > 0
  }
}

function create () {
  const emitter = new Emitter()

  emitter.setMaxListeners(0)

  return emitter
}

exports.create = create
