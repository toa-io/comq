'use strict'

const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { quantity, timeout } = require('@toa.io/generic')

const { When } = require('@cucumber/cucumber')

const PAYLOAD = quantity('500k')
const BATCH = 20
const DEADLINE = 25_000

When('I\'m flooding the {token} queue until back pressure is applied',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const buffer = randomBytes(PAYLOAD)
    const deadline = Date.now() + DEADLINE
    const pending = []

    while (!this.events.flow && Date.now() < deadline) {
      for (let i = 0; i < BATCH; i++) { pending.push(this.io.request(queue, buffer).catch(() => {})) }

      await timeout(0)
    }

    assert.equal(this.events.flow, true, 'Back pressure hasn\'t been applied')
  })
