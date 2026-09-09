'use strict'

const assert = require('node:assert')
const { until } = require('../../test/helpers')
const { Then } = require('@cucumber/cucumber')

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
    const parked = 'comq.parked.' + queue

    await this.io.process(parked, (payload, properties) => {
      this.parked[queue] = { payload, properties }
    })

    await until(() => this.parked[queue] !== undefined)

    const message = this.parked[queue]

    assert.notEqual(message, undefined, `Nothing was parked in ${parked}`)

    const headers = message.properties.headers

    assert.equal(headers['x-comq-queue'], queue, 'The parked message does not name its queue')
    assert.notEqual(headers['x-comq-reason'], undefined, 'The parked message has no reason')

    // the message came back through the default exchange on every retry, so this
    // is only right if the origin was recorded on the first failure
    assert.equal(headers['x-comq-exchange'], exchange,
      `The parked message says it came from '${headers['x-comq-exchange']}'`)

    // derived rather than stated, so it cannot drift from the configured ladder
    assert.equal(headers['x-comq-attempt'], this.attempts.length,
      'The parked message was not retried to exhaustion')
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
