'use strict'

const assert = require('node:assert')
const { Then } = require('@cucumber/cucumber')

const { queues, BROKERS_AMOUNT } = require('./brokers')

Then('the broker holds {int} reply queue(s)',
  /**
   * @param {number} count
   */
  async function (count) {
    await held(0, count)
  })

Then('each broker holds {int} reply queue(s)',
  /**
   * @param {number} count
   */
  async function (count) {
    for (let n = 0; n < BROKERS_AMOUNT; n++) await held(n, count)
  })

/**
 * @param {number} broker
 * @param {number} count
 */
async function held (broker, count) {
  const replies = (await queues(broker)).filter((name) => name.startsWith(PREFIX))

  assert.equal(replies.length, count,
    `Broker ${broker} holds ${replies.length} reply queue(s): ${replies.join(', ')}`)
}

const PREFIX = 'comq.reply'
