'use strict'

const { memo } = require('./memo')
const { failsafe } = require('./failsafe')
const { lazy } = require('./lazy')
const { track } = require('./track')
const { recall } = require('./recall')

exports.memo = memo
exports.failsafe = failsafe
exports.lazy = lazy
exports.track = track
exports.recall = recall
