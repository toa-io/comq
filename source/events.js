'use strict'

/** @type {comq.diagnostics.Event[]} */
exports.connection = ['open', 'close']

/** @type {comq.diagnostics.Event[]} */
exports.channel = ['flow', 'drain', 'recover', 'discard', 'pause', 'resume']
