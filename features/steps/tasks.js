'use strict'

const assert = require('node:assert')
const { Given, Then } = require('@cucumber/cucumber')

Given('tasks from the {token} queue are being processed',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const process = (message) => {
      this.processed = message
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

Then('the task has been received',
  /**
   * @this {comq.features.Context}
   */
  function () {
    assert.notEqual(this.enqueued, undefined, 'Task was not enqueued')
    assert.equal(this.processed, this.enqueued, 'Task was not processed')
  })
