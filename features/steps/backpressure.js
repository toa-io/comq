'use strict'

const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { quantity, timeout } = require('@toa.io/generic')

const { When } = require('@cucumber/cucumber')

const BASE_PAYLOAD = quantity('500k')
const BASE_BATCH = 20
const DEADLINE = 25_000

When('I\'m flooding the {token} queue until back pressure is applied',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const deadline = Date.now() + DEADLINE
    const pending = []
    const errors = []
    let iteration = 0

    while (!this.events.flow && Date.now() < deadline) {
      if (errors.length > 0) throw errors[0]

      const payload = BASE_PAYLOAD * (iteration + 1)
      const batch = BASE_BATCH * (iteration + 1)
      const buffer = randomBytes(payload)

      for (let i = 0; i < batch; i++) {
        pending.push(
          this.io.request(queue, buffer).catch((exception) => {
            errors.push(exception)
          })
        )
      }

      iteration++
      await timeout(0)

      if (errors.length > 0) throw errors[0]
    }

    if (errors.length > 0) throw errors[0]

    assert.equal(this.events.flow, true, 'Back pressure hasn\'t been applied')
  })
