'use strict'

const assert = require('node:assert')
const { Given, When, Then, defineParameterType } = require('@cucumber/cucumber')
const { connect } = require('../../')
const { timeout, until } = require('../../test/helpers')
const { BROKERS_AMOUNT, getAddress, USER, PASSWORD } = require('./brokers')
const { Network } = require('./networks')

defineParameterType({
  name: 'broker',
  regexp: /(first|second)/,
  transformer: (value) => ORDINALS.indexOf(value)
})

Given('{number} names standing for the {broker} broker',
  /**
   * @param {number} amount
   * @param {number} n
   * @this {comq.features.Context}
   */
  async function (amount, n) {
    await expose.call(this)

    for (let i = 0; i < amount; i++) this.names[name(i)] = ADDRESSES[n]
  })

Given('{number} names, half of them standing for each broker',
  /**
   * @param {number} amount
   * @this {comq.features.Context}
   */
  async function (amount) {
    await expose.call(this)

    for (let i = 0; i < amount; i++) this.names[name(i)] = ADDRESSES[i < amount / 2 ? 0 : 1]
  })

Given('the names settle in {number}ms',
  /**
   * @param {number} settle
   * @this {comq.features.Context}
   */
  function (settle) {
    this.resolution.settle = settle
  })

Given('a broker lingers for {number}ms',
  /**
   * @param {number} linger
   * @this {comq.features.Context}
   */
  function (linger) {
    this.resolution.linger = linger
  })

Given('an active connection to the names', connectNames)

When('I connect to the names', connectNames)

When('I connect to the range of the names',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    const amount = Object.keys(this.names).length

    await this.connectNames([name(`[0..${amount}]`)], PORT)
  })

When('half of the names move to the {broker} broker',
  /**
   * @param {number} n
   * @this {comq.features.Context}
   */
  function (n) {
    const names = Object.keys(this.names)

    for (const name of names.slice(names.length / 2)) this.names[name] = ADDRESSES[n]
  })

When('the names move to the {broker} broker', move)

When('the names keep moving between the brokers for {number}ms',
  /**
   * @param {number} duration
   * @this {comq.features.Context}
   */
  async function (duration) {
    const flips = Math.floor(duration / FLIP_MS)

    // an odd number of moves would leave the names moved
    for (let i = 0; i < flips + flips % 2; i++) {
      move.call(this, (i + 1) % 2)

      await timeout(FLIP_MS)
    }
  })

When('the {broker} broker is out of reach',
  /**
   * @param {number} n
   * @this {comq.features.Context}
   */
  function (n) {
    this.networks[n].cut()
  })

When('a task is enqueued to the {token} queue of the {broker} broker by another connection',
  /**
   * @param {string} queue
   * @param {number} n
   * @this {comq.features.Context}
   */
  async function (queue, n) {
    const io = await connect('amqp://' + USER + ':' + PASSWORD + '@' + getAddress(n))

    this.enqueued = 'left behind'

    await io.enqueue(queue, this.enqueued)
    await io.close()
  })

Then('the task is processed',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    const processed = await until(() => this.processed === this.enqueued)

    assert.equal(processed, true, 'the task was not processed')
  })

Then('the {broker} broker has joined', heard('join'))

Then('the {broker} broker is retired', heard('retire'))

Then('the {broker} broker is left', heard('leave'))

Then('the {broker} broker is not left',
  /**
   * @param {number} n
   * @this {comq.features.Context}
   */
  function (n) {
    assert.equal(this.brokers.leave.includes(ADDRESSES[n]), false, 'the broker is left')
  })

Then('no broker has joined or retired',
  /**
   * @this {comq.features.Context}
   */
  function () {
    assert.deepEqual(this.brokers, { join: [], retire: [], leave: [] })
  })

Then('{number} connection(s) is/are open to the {broker} broker', open)

Then('{number} connection is open to each broker',
  /**
   * @param {number} amount
   * @this {comq.features.Context}
   */
  async function (amount) {
    for (let n = 0; n < BROKERS_AMOUNT; n++) await open.call(this, amount, n)
  })

/**
 * Each broker is given an address of its own, at one port: a name resolves to an address and
 * says nothing of a port, and the brokers of the suite differ in nothing but theirs.
 *
 * @this {comq.features.Context}
 */
async function expose () {
  if (this.networks.length > 0) return

  for (let n = 0; n < BROKERS_AMOUNT; n++) {
    const network = new Network(n, ADDRESSES[n], PORT)

    await network.open()

    this.networks[n] = network
  }

  global.COMQ_TESTING_LOOKUP = async (host) => ({ addresses: [this.names[host]], ttl: 0 })
}

/**
 * @this {comq.features.Context}
 */
async function connectNames () {
  await this.connectNames(Object.keys(this.names), PORT)
}

/**
 * @param {number} n
 * @this {comq.features.Context}
 */
function move (n) {
  for (const name of Object.keys(this.names)) this.names[name] = ADDRESSES[n]
}

/**
 * @param {number} amount
 * @param {number} n
 * @this {comq.features.Context}
 */
async function open (amount, n) {
  await until(() => this.networks[n].connections === amount)

  assert.equal(this.networks[n].connections, amount)
}

/**
 * @param {'join' | 'retire' | 'leave'} event
 */
function heard (event) {
  /**
   * @param {number} n
   * @this {comq.features.Context}
   */
  return async function (n) {
    const happened = await until(() => this.brokers[event].includes(ADDRESSES[n]), 10_000)

    assert.equal(happened, true, `the broker did not ${event}`)
  }
}

/**
 * @param {number | string} i
 * @return {string}
 */
function name (i) {
  return `shard-${i}.test`
}

const ORDINALS = ['first', 'second']

/** Loopback addresses, which every one of 127.0.0.0/8 is. */
const ADDRESSES = ['127.0.0.2', '127.0.0.3']

const PORT = 56790

/** Sooner than the names settle. */
const FLIP_MS = 100
