'use strict'

/** @type {comq.diagnostics.Event[]} */
exports.connection = ['open', 'close', 'error', 'reconnect', 'exhausted']

/**
 * What a sharded connection tells of the brokers its names stand for.
 *
 * @type {comq.diagnostics.Event[]}
 */
exports.shards = ['join', 'retire', 'leave']

/** @type {comq.diagnostics.Event[]} */
exports.channel = ['flow', 'drain', 'recover', 'discard', 'retry', 'pause', 'resume', 'return', 'lost', 'remove', 'taken']
