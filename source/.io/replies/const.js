'use strict'

exports.control = {
  ok: 'ok',
  heartbeat: 'heartbeat',
  end: 'end'
}

exports.HEARTBEAT_INTERVAL = 10_000
exports.IDLE_INTERVAL = exports.HEARTBEAT_INTERVAL * 1.5
