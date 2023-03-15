'use strict'

const assert = require('node:assert')
const { generate } = require('randomstring')
const { timeout } = require('@toa.io/generic')
const { Given, When, Then } = require('@cucumber/cucumber')

Given('(that ){token} is consuming events from the {token} exchange',
  /**
   * @param {string} group
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (group, exchange) {
    await consume(this, group, exchange)
  })

Given('{token} consuming events from the {token} exchange is expected',
  /**
   * @param {string} group
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (group, exchange) {
    await timeout(500) // let it crash

    this.expected = consume(this, group, exchange)
  })

When('I emit an event to the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    if (this.expected) await this.expected

    const message = generate()

    await this.io.emit(exchange, message)

    this.published = message
  })

Then('{token} receives the event',
  /**
   * @param {string} group
   * @this {comq.features.Context}
   */
  async function (group) {
    await timeout(100)

    assert.notEqual(this.published, undefined, 'No event has been published')
    assert.equal(this.published, this.consumed[group], `'${group}' haven't consumed event`)
  })

/**
 * @param {comq.features.Context} context
 * @param {string} group
 * @param {string} exchange
 * @return {Promise<void>}
 */
const consume = async (context, group, exchange) => {
  context.consumed ??= {}

  return context.io.consume(exchange, group, async (payload) => {
    context.consumed[group] = payload
  })
}
