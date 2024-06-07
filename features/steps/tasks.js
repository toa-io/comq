'use strict'

const assert = require('node:assert')
const { Given, Then, When } = require('@cucumber/cucumber')
const { quantity, timeout } = require('@toa.io/generic')
const { randomBytes } = require('node:crypto')
const stream = require('node:stream')

Given('tasks from the {token} queue are being processed',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const process = (message) => {
      this.processed = message
      this.tasksProcessedCount++
    }

    await this.io.process(queue, process)
  })

Given('a task is sent to the {token} queue',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    this.enqueued = 'hello'

    await this.io.enqueue(queue, this.enqueued)
  })

When('a stream of {quantity} tasks is sent to the {token} queue',
  /**
   * @param {string} amountQ
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (amountQ, exchange) {
    const amount = quantity(amountQ)

    function * generate () {
      for (let i = 0; i < amount; i++) yield randomBytes(8)
    }

    const tasks = stream.Readable.from(generate())

    await this.io.enqueue(exchange, tasks)
  })

Then('the task has been received',
  /**
   * @this {comq.features.Context}
   */
  function () {
    assert.notEqual(this.enqueued, undefined, 'Task was not enqueued')
    assert.equal(this.processed, this.enqueued, 'Task was not processed')
  })

Then('{quantity} tasks ha(ve)(s) been processed',
  /**
   * @this {comq.features.Context}
   */
  async function (expectedQ) {
    const expected = quantity(expectedQ)

    await timeout(100) // let it process
    assert.equal(this.tasksProcessedCount, expected, 'Not all tasks have been processed')
  })
