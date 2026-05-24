'use strict'

/**
 * @module comq
 */

const { connect, assert } = require('./connect')

/**
 * Open a new connection (and underlying channels) for each call.
 * @type {comq.Connect}
 */
exports.connect = connect

/**
 * Reuse a singleton connection per broker URL (reference counting).
 * @type {comq.Connect}
 */
exports.assert = assert
