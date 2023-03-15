'use strict'

const assert = require('node:assert')
const { timeout } = require('@toa.io/generic')
const { Then } = require('@cucumber/cucumber')

Then('the message is discarded',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    if (this.events.discard !== true) await timeout(50)

    assert.equal(this.events.discard, true, 'The {message} was not discarded')
  })
