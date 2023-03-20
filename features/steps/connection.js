'use strict'

const assert = require('node:assert')
const { timeout, promex } = require('@toa.io/generic')

const { Given, When, Then } = require('@cucumber/cucumber')

Given('an active connection to the broker',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.connecting = this.connect()

    await this.connecting
  })

Given('an active sharded connection',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.sharded = true
    this.connecting = this.connect()

    await this.connecting
  })

Given('the connection to both shards is established',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    const promise = promex()

    this.sharded = true
    this.connecting = this.connect()

    await this.connecting

    // second shard is connected
    this.io.diagnose('open', () => promise.resolve())

    return promise
  })

When('I attempt to connect to the broker for {number} second(s)',
  /**
   * @param {number} interval
   * @this {comq.features.Context}
   */
  async function (interval) {
    const gap = timeout(interval * 1000)

    this.connecting = connect(this)

    await Promise.any([this.connecting, gap])
  })

When('I attempt to connect to the broker',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await connect(this)
  })

When('I attempt to connect to the broker as {string} with password {string}',
  /**
   * @param {string} user
   * @param {string} password
   * @this {comq.features.Context}
   */
  async function (user, password) {
    await connect(this, user, password)
  })

When('I attempt to establish sharded connection',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.sharded = true

    await connect(this)
  })

Then('the connection is not established',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    assert.equal(this.connected, false, 'connection is established contrary to expectations')
  })

Then('the connection is established',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    if (this.connecting !== undefined) await this.connecting

    assert.equal(this.connected, true, 'connection is not established')
  })

Then('no exceptions are thrown',
  /**
   * @this {comq.features.Context}
   */
  function () {
    assert.equal(this.exception, undefined, 'exception is thrown: ' + this.exception?.message)
  })

Then('an exception is thrown: {string}',
  /**
   * @param {string} message
   * @this {comq.features.Context}
   */
  function (message) {
    assert.notEqual(this.exception, undefined, 'exception isn\'t thrown')

    assert.equal(this.exception.message.includes(message), true,
      'exception message mismatch ' + this.exception.message)
  })

Then('the connection is {connection-event}',
  /**
   * @param {'lost' | 'restored'} key
   * @this {comq.features.Context}
   */
  async function (key) {
    const event = CONNECTION_EVENTS[key]
    const gap = CONNECTION_GAPS[key]

    await timeout(gap)

    assert.equal(this.events[event], true, 'connection was not ' + key)
  })

Given('the connection has started sealing',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.sealing = this.io.seal()
  })

Then('the connection is sealed',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.sealing
  })

/**
 * @param {comq.features.Context} context
 * @param {string} [user]
 * @param {string} [password]
 * @returns {Promise<void>}
 */
const connect = async (context, user, password) => {
  try {
    await context.connect(user, password)
  } catch (exception) {
    context.exception = exception
  }
}

const CONNECTION_EVENTS = {
  lost: 'close',
  restored: 'open'
}

const CONNECTION_GAPS = {
  lost: global.COMQ_TESTING_CONNECTION_GAP_LOST ?? 10,
  restored: global.COMQ_TESTING_CONNECTION_GAP_RESTORED ?? 5000
}
