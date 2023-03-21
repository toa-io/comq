'use strict'

const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { quantity, timeout } = require('@toa.io/generic')

const { When, Then } = require('@cucumber/cucumber')

When('I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz for {number} second(s)',
  /**
   * @param {string} bytesQ
   * @param {string} queue
   * @param {string} frequencyQ
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (bytesQ, queue, frequencyQ, seconds) {
    const bytes = quantity(bytesQ)
    const frequency = quantity(frequencyQ)
    const buffer = randomBytes(bytes)
    const times = seconds * frequency

    // intervals less than 1ms are not accurate
    const interval = Math.max((1000 / frequency), 1)
    const each = Math.max(1 / (1000 / frequency), 1)

    const promises = []

    for (let i = 0; i < times; i++) {
      const promise = this.io.request(queue, buffer)

      promises.push(promise)

      if ((i + 1) % each === 0) await timeout(interval)
    }

    await Promise.all(promises)
  })

Then('back pressure was applied',
  /**
   * @this {comq.features.Context}
   */
  function () {
    assert.equal(this.events.flow, true, 'Back pressure hasn\'t been applied')
  })
