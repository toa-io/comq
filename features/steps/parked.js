'use strict'

const assert = require('node:assert')
const amqplib = require('amqplib')
const { Given, When, Then } = require('@cucumber/cucumber')

const { getAddress, USER, PASSWORD } = require('./brokers')
const { until, timeout } = require('../../test/helpers')

Given('a producer failing every request to the {token} queue',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    await this.io.reply(queue, () => {
      throw new Error('Expected failure')
    })
  })

When('a request is sent to the {token} queue',
  /**
   * The caller is left waiting on purpose: the promise is what the last step asserts on.
   *
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    this.awaited = this.io.request(queue, { question: 'the answer?' }, 'application/json')

    // nothing settles it unless the parked request is answered, and an unhandled
    // rejection would take the run down before the assertion is reached
    this.awaited.catch(() => undefined)
  })

Then('the request is parked',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await until(() => this.events.discard === true)

    assert.equal(this.events.discard, true, 'The request was not parked')
  })

When('the parked request from the {token} queue is answered by hand',
  /**
   * What an operator draining the parking queue would do: take the message, read who
   * was asking, and publish the reply they are still waiting for.
   *
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const connection = await amqplib.connect(`amqp://${USER}:${PASSWORD}@${getAddress(0)}`)
    const channel = await connection.createChannel()

    try {
      let parked

      await channel.consume('comq.parked.' + queue, (message) => {
        parked = message
        channel.ack(message)
      })

      await until(() => parked !== undefined)

      assert.notEqual(parked, undefined, `Nothing was parked from ${queue}`)

      const { replyTo, correlationId, contentType } = parked.properties

      assert.notEqual(replyTo, undefined, 'The parked request lost its replyTo')
      assert.notEqual(correlationId, undefined, 'The parked request lost its correlationId')

      this.answer = { answered: true, was: JSON.parse(parked.content.toString()) }

      channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(this.answer)),
        { correlationId, contentType })

      // let the frame reach the broker before the connection goes
      await timeout(100)
    } finally {
      await channel.close()
      await connection.close()
    }
  })

Then('the caller receives the reply',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    const reply = await Promise.race([
      this.awaited,
      timeout(5000).then(() => TIMED_OUT)
    ])

    assert.notEqual(reply, TIMED_OUT, 'The caller is still waiting')
    assert.deepEqual(reply, this.answer, 'The caller received something else')
  })

const TIMED_OUT = Symbol('the caller was still waiting')
