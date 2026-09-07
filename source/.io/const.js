'use strict'

exports.control = {
  ok: 'ok',
  heartbeat: 'heartbeat',
  end: 'end',
  pause: 'pause',
  resume: 'resume'
}

/**
 * Set on the confirmation message by a producer that honours `pause` and
 * `resume`, so that a consumer never sends them to one that does not.
 */
exports.FLOW_HEADER = 'x-flow'

exports.HEARTBEAT_INTERVAL = 5_000
exports.IDLE_INTERVAL = 12_000
