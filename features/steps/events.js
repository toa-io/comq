'use strict'

const stream = require('node:stream')
const assert = require('node:assert')
const { randomBytes } = require('node:crypto')
const { timeout, quantity, match } = require('@toa.io/generic')
const { parse } = require('@toa.io/yaml')
const { Given, When, Then } = require('@cucumber/cucumber')

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

    this.consumptionPromise = consume.call(this, group, exchange)
  })

Given('(that )events are exclusively consumed from the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    this.consumptionPromise = consume.call(this, undefined, exchange)
  })

When('an event is emitted to the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    const message = randomBytes(8)

    await emit.call(this, exchange, message)
  })

When('an event is emitted to the {token} exchange with properties:',
  /**
   * @param {string} exchange
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (exchange, yaml) {
    const message = randomBytes(8)
    const properties = parse(yaml)

    await emit.call(this, exchange, message, properties)
  })

When('a stream of {quantity} events is emitted to the {token} exchange',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (amountQ, exchange) {
    const amount = quantity(amountQ)

    function * generate () {
      for (let i = 0; i < amount; i++) yield randomBytes(8)
    }

    const events = stream.Readable.from(generate())

    await emit.call(this, exchange, events)
  })

Then('{token} receives the event',
  /**
   * @param {string} group
   * @this {comq.features.Context}
   */
  async function (group) {
    await consumed.call(this, group)
  })

Then('{token} receives the event with properties:',
  /**
   * @param {string} group
   * @param {string} yaml
   * @this {comq.features.Context}
   */
  async function (group, yaml) {
    await consumed.call(this, group)

    const properties = parse(yaml)
    const matches = match(this.consumed[group].properties, properties)

    assert.equal(matches, true, 'Consumed event properties doesn\'t match')
  })

Then('the event is received',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await consumed.call(this)
  })

Then('{quantity} events is received',
  /**
   * @this {comq.features.Context}
   */
  async function (expectedQ) {
    const expected = quantity(expectedQ)

    await timeout(100) // let it consume
    assert.equal(this.eventsConsumedCount, expected, 'Not all events have been consumed')
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

  const consumer = async (payload, properties) => {
    this.consumed[group] = { payload, properties }
    this.eventsConsumedCount++
  }

  return group === undefined
    ? this.io.consume(exchange, consumer)
    : this.io.consume(exchange, group, consumer)
}

/**
 * @param {string} group
 * @return {Promise<void>}
 */
async function consumed (group) {
  await timeout(100) // let it consume

  assert.notEqual(this.published, undefined, 'No event has been published')

  const consumed = this.consumed[group]
  const equals = this.published.equals(consumed.payload)

  assert.equal(equals, true, 'Consumed event doesn\'t match')
}

/**
 * @param {string} exchange
 * @param {any} message
 * @param {import('amqplib').Options.Publish} [properties]
 * @return {Promise<void>}
 * @this {comq.features.Context}
 */
async function emit (exchange, message, properties) {
  if (this.consumptionPromise) await this.consumptionPromise

  await this.io.emit(exchange, message, properties)

  this.published = message
}
