'use strict'

const assert = require('node:assert')
const { Given, When, Then } = require('@cucumber/cucumber')
const { Abandoned } = require('../../')
const { timeout } = require('../../test/helpers')

Given('a producer replying {token} queue by requesting the {token} queue',
  /**
   * @param {string} queue
   * @param {string} downstream
   * @this {comq.features.Context}
   */
  async function (queue, downstream) {
    this.handling = new Promise((resolve) => { this.handled = resolve })

    const producer = async (request) => {
      const reply = this.io.request(downstream, request)

      this.handled()

      try {
        return await reply
      } catch (error) {
        // recorded rather than rethrown: what this asserts is what the caller was told,
        // and a rejected producer would have the delivery retried on top of it
        this.abandoned = error

        return null
      }
    }

    await this.io.reply(queue, producer)
  })

When('the producer is handling the request',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.handling

    // the consumer's own Request is outstanding as well, and abandoning abandons that one too;
    // its outcome is taken here so that it is asserted rather than left to surface as an
    // unhandled rejection
    this.reply.catch((error) => { this.refused = error })
  })

When('the connection has started closing',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.closing = this.io.close()
  })

When('the connection abandons its replies',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.io.abandon()
  })

Then('the connection closes within {number}ms',
  /**
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (ms) {
    const io = this.io

    // taken off the world so that the hook on the way out does not await a close
    // this may have just proven does not end
    this.io = undefined
    this.connected = false

    const closing = io.close().then(() => true, () => true)
    const closed = await Promise.race([closing, timeout(ms).then(() => false)])

    assert.ok(closed, `The connection did not close within ${ms}ms`)
  })

Then('the producer was told its reply is abandoned',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.ok(this.abandoned instanceof Abandoned,
      `The producer was told ${this.abandoned ?? 'nothing'}`)
  })

Then('the consumer was told its own reply is abandoned',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.ok(this.refused instanceof Abandoned,
      `The consumer was told ${this.refused ?? 'nothing'}`)
  })

Then('a request to the {token} queue is refused as abandoned',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    await assert.rejects(() => this.io.request(queue, null), Abandoned)
  })
