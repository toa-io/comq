'use strict'

/** @type {comq.diagnostics.Event[]} */
exports.connection = ['open', 'close', 'error', 'reconnect', 'exhausted']

/** @type {comq.diagnostics.Event[]} */
exports.channel = ['flow', 'drain', 'recover', 'discard', 'retry', 'pause', 'resume', 'return', 'lost', 'remove']
