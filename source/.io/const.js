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

/**
 * Set on a request by a requester that reads a reply stream's values in batches, so that a
 * producer never sends one to a requester that would take it for a single value.
 */
exports.BATCH_HEADER = 'x-batch'

/** The type of a message carrying values: a list of them, or buffers prefixed with their length. */
exports.batch = {
  values: 'batch',
  buffers: 'buffers'
}

exports.HEARTBEAT_INTERVAL = 5_000
exports.IDLE_INTERVAL = 12_000
