'use strict'

/** @type {comq.diagnostics.Event[]} */
exports.connection = ['open', 'close', 'error', 'reconnect']

/** @type {comq.diagnostics.Event[]} */
exports.channel = ['flow', 'drain', 'recover', 'discard', 'pause', 'resume', 'return', 'lost']
