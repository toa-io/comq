'use strict'

const assert = require('node:assert')
const { randomBytes } = require('node:crypto')

const { Given, When, Then } = require('@cucumber/cucumber')

Given('the AMQP channel limit is set to {number}',
  /**
   * @param {number} limit
   */
  function (limit) {
    global.COMQ_TESTING_AMQP_CHANNEL_MAX = limit
  })

When('emitting an event to the {token} exchange is attempted',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    this.exception = undefined

    await this.io.emit(exchange, randomBytes(8))
      .catch((exception) => { this.exception = exception })
  })

Then('the exception is thrown: {string}',
  /**
   * @param {string} message
   * @this {comq.features.Context}
   */
  function (message) {
    assert.notEqual(this.exception, undefined, 'no exception was thrown')
    assert.equal(this.exception.message, message)
  })

Then('the {token} event is emitted',
  /**
   * @param {comq.diagnostics.Event} event
   * @this {comq.features.Context}
   */
  function (event) {
    assert.equal(this.events[event], true, `the '${event}' event was not emitted`)
  })
