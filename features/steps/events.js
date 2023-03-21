'use strict'

const assert = require('node:assert')
const { generate } = require('randomstring')
const { timeout, quantity } = require('@toa.io/generic')
const { Given, When, Then } = require('@cucumber/cucumber')
const { randomBytes } = require('node:crypto')

Given('(that ){token} is consuming events from the {token} exchange',
  /**
   * @param {string} group
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (group, exchange) {
    await consume.call(this, group, exchange)
  })

Given('{token} consuming events from the {token} exchange is expected',
  /**
   * @param {string} group
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (group, exchange) {
    await timeout(500) // let it crash

    this.expected = consume.call(this, group, exchange)
  })

Given('(that )events are exclusively consumed from the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    this.expected = consume.call(this, undefined, exchange)
  })

When('an event is emitted to the {token} exchange',
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
    await consumed.call(this, group)
  })

Then('the event is received',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await consumed.call(this)
  })

Given('I\'m publishing {quantity}B events to the {token} exchange at {quantity}Hz',
  /**
   * @param {string} bytesQ
   * @param {string} queue
   * @param {string} frequencyQ
   * @this {comq.features.Context}
   */
  async function (bytesQ, queue, frequencyQ) {
    const bytes = quantity(bytesQ)
    const frequency = quantity(frequencyQ)
    const buffer = randomBytes(bytes)

    const delay = Math.max((1000 / frequency), 1)

    const emit = async () => {
      await this.io.emit(queue, buffer)

      this.eventsPublishedCount++
    }

    this.publishing = setInterval(emit, delay)

    await timeout(delay * 2) // send at least twice
  })

Then('all events have been received',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    clearInterval(this.publishing)

    await timeout(50)

    assert.equal(this.eventsPublishedCount, this.eventsConsumedCount, 'Not all events has been consumed')
  })

/**
 * @this {comq.features.Context} context
 * @param {string} group
 * @param {string} exchange
 * @return {Promise<void>}
 */
async function consume (group, exchange) {
  this.consumed ??= {}

  return this.io.consume(exchange, group, async (payload) => {
    this.consumed[group] = payload
    this.eventsConsumedCount++
  })
}

/**
 * @param {string} group
 * @return {Promise<void>}
 */
async function consumed (group) {
  await timeout(100) // let it consume

  assert.notEqual(this.published, undefined, 'No event has been published')
  assert.equal(this.published, this.consumed[group], 'Event hasn\'t been exclusively consumed')
}
