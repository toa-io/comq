'use strict'

const assert = require('node:assert')
const { until } = require('../../test/helpers')
const { Then } = require('@cucumber/cucumber')
const { PARKED, reading, pick } = require('./parking')

Then('the event is attempted {int} time(s)',
  /**
   * @param {number} times
   * @this {comq.features.Context}
   */
  async function (times) {
    await until(() => this.attempts.length >= times)

    const expected = Array.from({ length: times }, (_, index) => index + 1)

    assert.deepEqual(this.attempts, expected,
      `Expected attempts ${expected.join(', ')} but saw ${this.attempts.join(', ')}`)
  })

Then('the message is parked',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await until(() => this.events.discard === true)

    assert.equal(this.events.discard, true, 'The message was not parked')
  })

Then('the parked message is kept, and says it came from the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    const queue = exchange + '..exceptions' // the group the throwing consumer uses

    await reading(async (channel) => {
      const message = await pick(channel,
        (one) => one.properties.headers?.['x-comq-queue'] === queue)

      assert.notEqual(message, undefined, `Nothing in '${PARKED}' came from ${queue}`)

      const headers = message.properties.headers

      assert.notEqual(headers['x-comq-reason'], undefined, 'The parked message has no reason')

      // the message came back through the default exchange on every retry, so this
      // is only right if the origin was recorded on the first failure
      assert.equal(headers['x-comq-exchange'], exchange,
        `The parked message says it came from '${headers['x-comq-exchange']}'`)

      // absent on a message parked from its first delivery, exactly as a consumer reads it;
      // derived rather than stated, so it cannot drift from the configured ladder
      assert.equal(headers['x-comq-attempt'] ?? 1, this.attempts.length,
        'The parked message did not have as many attempts as the consumer saw')

      channel.ack(message)
    })
  })

Then('{token} has received {int} event(s)',
  /**
   * @param {string} group
   * @param {number} count
   * @this {comq.features.Context}
   */
  async function (group, count) {
    await until(() => this.counts[group] >= count)

    assert.equal(this.counts[group] ?? 0, count,
      `Expected ${group} to receive ${count} event(s), got ${this.counts[group] ?? 0}`)
  })
