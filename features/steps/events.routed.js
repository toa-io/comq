'use strict'

const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { timeout } = require('../../test/helpers')
const { parse } = require('./yaml')
const { Given, When, Then } = require('@cucumber/cucumber')

Given('(that ){token} is bound to the {token} exchange under the {token} key',
  /**
   * @param {string} queue
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (queue, exchange, key) {
    await subscribe.call(this, queue, exchange, key)
  })

When('a message is routed to the {token} exchange under the {token} key',
  /**
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    const message = randomBytes(8)

    await this.io.route(exchange, key, message)

    this.published = message
  })

Then('{token} receives nothing',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    await timeout(100) // let it not consume

    assert.equal(this.consumed[queue], undefined, `'${queue}' has received an event`)
  })

/**
 * @param {string} queue
 * @param {string} exchange
 * @param {string} key
 * @this {comq.features.Context}
 */
async function subscribe (queue, exchange, key) {
  await this.io.subscribe(exchange, queue, key, async (payload, properties) => {
    this.consumed[queue] = { payload, properties }
    this.eventsConsumedCount++
  })
}

Given('{token} is retained on the {token} exchange under the {token} key',
  /**
   * @param {string} queue
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (queue, exchange, key) {
    await this.io.retain(exchange, queue, key)
  })

Given('{token} is retained on the {token} exchange under the {token} key with arguments:',
  /**
   * @param {string} queue
   * @param {string} exchange
   * @param {string} key
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (queue, exchange, key, yaml) {
    await this.io.retain(exchange, queue, key, parse(yaml))
  })

When('another message is routed to the {token} exchange under the {token} key',
  /**
   * @param {string} exchange
   * @param {string} key
   * @this {comq.features.Context}
   */
  async function (exchange, key) {
    this.first = this.published

    const message = randomBytes(8)

    await this.io.route(exchange, key, message)

    this.published = message
  })

Then('{token} receives the first event',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    await timeout(100) // let it consume

    assert.notEqual(this.first, undefined, 'No first event has been published')
    assert.notEqual(this.consumed[queue], undefined, `'${queue}' has received nothing`)
    assert.equal(this.first.equals(this.consumed[queue].payload), true,
      `'${queue}' has received another event`)
  })
