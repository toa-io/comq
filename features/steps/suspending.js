'use strict'

const assert = require('node:assert')
const { When, Then } = require('@cucumber/cucumber')
const { timeout } = require('../../test/helpers')

const POLL = 50

When('the connection is suspended',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.io.suspend()
  })

When('the connection is unsuspended',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.io.unsuspend()
  })

Then('{token} receives nothing within {number}ms',
  /**
   * @param {string} group
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (group, ms) {
    await timeout(ms)

    assert.equal(this.consumed[group], undefined,
      'An event was consumed while consumption was suspended')
  })

Then('{token} receives the event within {number}ms',
  /**
   * @param {string} group
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (group, ms) {
    await until(() => this.consumed[group] !== undefined, ms)

    assert.notEqual(this.consumed[group], undefined, 'The event was not consumed')
    assert.equal(this.published.equals(this.consumed[group].payload), true,
      'The event consumed is not the one published')
  })

Then('no task is processed within {number}ms',
  /**
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (ms) {
    await timeout(ms)

    assert.equal(this.processed, undefined,
      'A task was processed while consumption was suspended')
  })

Then('the task is processed within {number}ms',
  /**
   * @param {number} ms
   * @this {comq.features.Context}
   */
  async function (ms) {
    await until(() => this.processed !== undefined, ms)

    assert.equal(this.processed, this.enqueued, 'The task was not processed')
  })

/**
 * @param {() => boolean} condition
 * @param {number} ms
 */
async function until (condition, ms) {
  const deadline = Date.now() + ms

  while (!condition() && Date.now() < deadline) await timeout(POLL)
}
