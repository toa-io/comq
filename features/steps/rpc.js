'use strict'

const stream = require('node:stream')
const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { parse } = require('@toa.io/yaml')
const { match, timeout, quantity } = require('@toa.io/generic')
const { Given, When, Then } = require('@cucumber/cucumber')
const { Readable } = require('node:stream')

Given('function replying {token} queue:',
  /**
   * @param {string} queue
   * @param {string} javascript
   * @this {comq.features.Context}
   */
  async function (queue, javascript) {
    // eslint-disable-next-line no-new-func
    const producer = new Function('return ' + javascript)()

    await this.io.reply(queue, producer)
  })

Given('a generator replying {token} queue:',
  /**
   * @param {string} queue
   * @param {string} javascript
   * @this {comq.features.Context}
   */
  async function (queue, javascript) {
    // eslint-disable-next-line no-new-func
    const generator = new Function('return ' + javascript)()

    function producer (input) {
      return Readable.from(generator(input))
    }

    await this.io.reply(queue, producer)
  })

Given('a producer replying {token} queue',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const producer = async (request) => {
      await timeout(10)

      return request
    }

    await this.io.reply(queue, producer)
  })

Given('function replying {token} queue is expected:',
  /**
   * @param {string} queue
   * @param {string} javascript
   * @this {comq.features.Context}
   */
  async function (queue, javascript) {
    // eslint-disable-next-line no-new-func
    const producer = new Function('return ' + javascript)()

    this.expected = this.io.reply(queue, producer)
  })

When('the consumer sends the following request to the {token} queue:',
  /**
   * @param {string} queue
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (queue, yaml) {
    const payload = parse(yaml)

    await send.call(this, queue, payload)
  })

When('the consumer sends a request to the {token} queue',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const payload = randomBytes(8)

    await send.call(this, queue, payload)
  })

When('the consumer fetches a stream with the following request to the {token} queue:',
  /**
   * @param {string} queue
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (queue, yaml) {
    const payload = parse(yaml)

    await fetch.call(this, queue, payload)
  })

Then('the consumer receives the reply:',
  /**
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (yaml) {
    const value = parse(yaml)
    const reply = await this.reply
    const matches = match(reply, value)

    assert.equal(matches, true, 'Reply mismatch')
  })

Then('the consumer receives the reply',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.reply
  })

Then('the consumer does not receive the reply',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    let reply

    const get = async () => (reply = await this.reply)
    const gap = () => timeout(50)

    await Promise.any([get(), gap()])

    assert.equal(reply, undefined, 'The reply was received')
  })

Then('the consumer receives the stream:',
  /**
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (yaml) {
    const values = parse(yaml)
    const replies = []

    for await (const reply of this.stream) replies.push(reply)

    const matches = match(replies, values)

    assert.equal(matches, true, 'Stream values mismatch')
  })

When('the consumer sends {quantity} requests to the {token} queue as a stream',
  /**
   * @param {string} amountQ
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (amountQ, queue) {
    const amount = quantity(amountQ)

    function * generate () {
      for (let i = 0; i < amount; i++) {
        yield randomBytes(8)
      }
    }

    const input = stream.Readable.from(generate())

    await send.call(this, queue, input)
  })

Then('the consumer receives {quantity} replies as a stream',
  /**
   * @this {comq.features.Context}
   */
  async function (amountQ) {
    const expected = quantity(amountQ)
    const output = await this.reply

    let actual = 0

    // eslint-disable-next-line no-unused-vars
    for await (const _ of output) {
      actual++
    }

    assert.equal(actual, expected, 'The amount of replies mismatches')
  })

Given('I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz',
  /**
   * @param {string} bytesQ
   * @param {string} queue
   * @param {string} frequencyQ
   * @this {comq.features.Context}
   */
  async function (bytesQ, queue, frequencyQ) {
    const bytes = quantity(bytesQ)
    const buffer = randomBytes(bytes)
    const frequency = quantity(frequencyQ)
    const delay = Math.max((1000 / frequency), 1)

    const emit = () => {
      const promise = this.io.request(queue, buffer)

      this.requestsSent.push(promise)
    }

    this.sending = setInterval(emit, delay)

    await timeout(delay) // send at least twice
  })

Then('all replies have been received',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    clearInterval(this.sending)

    await Promise.all(this.requestsSent)
  })

async function send (queue, payload) {
  if (this.expected) await this.expected

  this.reply = this.io.request(queue, payload)
}

async function fetch (queue, payload) {
  this.stream = await this.io.fetch(queue, payload)
}
