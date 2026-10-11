'use strict'

const assert = require('node:assert')
const amqplib = require('@toa.io/amqplib')
const { Given, When, Then, After } = require('@cucumber/cucumber')

const { connect } = require('../../')
const { getAddress, queues, USER, PASSWORD, BROKERS_AMOUNT } = require('./brokers')
const { timeout } = require('../../test/helpers')

Given('Request queues expire in {number}ms',
  /**
   * A setting of the connections that are made from here on.
   *
   * @param {number} expires
   * @this {comq.features.Context}
   */
  function (expires) {
    this.expires = expires
  })

Given('a producer on another connection replying {token} queue',
  /**
   * On a connection of its own, so that it can go while the consumer stays.
   *
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const urls = Array.from({ length: this.sharded ? BROKERS_AMOUNT : 1 }, (_, n) => url(n))

    this.replier = await connect(...urls, this.topology())

    await this.replier.reply(queue, (request) => request)
  })

Given('the {token} queue declared without an expiry',
  /**
   * As the versions that knew of none have declared their queues.
   *
   * @param {string} queue
   */
  async function (queue) {
    await managing(async (channel) => {
      await channel.deleteQueue(queue)
      await channel.assertQueue(queue, { durable: true })
    })

    legacy.add(queue)
  })

When('that producer is gone',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.replier.close()

    this.replier = undefined
  })

When('the {token} queue is deleted',
  /**
   * @param {string} queue
   */
  async function (queue) {
    await managing((channel) => channel.deleteQueue(queue))
  })

Then('the broker has the {token} queue',
  /**
   * @param {string} queue
   */
  async function (queue) {
    // a Request is sent without waiting for its queue to be declared
    const deadline = Date.now() + 1000

    while (!(await queues()).includes(queue)) {
      assert.ok(Date.now() < deadline, `The broker has no '${queue}' queue`)

      await timeout(100)
    }
  })

Then('the broker has no {token} queue',
  /**
   * @param {string} queue
   */
  async function (queue) {
    const deadline = Date.now() + DEADLINE

    while ((await queues()).includes(queue)) {
      assert.ok(Date.now() < deadline, `The broker still has the '${queue}' queue`)

      await timeout(100)
    }
  })

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.replier?.close()

    this.replier = undefined

    if (legacy.size === 0) return

    // a queue that does not expire is not left for the scenarios to come
    await managing(async (channel) => {
      for (const queue of legacy) await channel.deleteQueue(queue)
    })

    legacy.clear()
  })

/**
 * Runs `manage` against a connection of its own, so that what it does to a queue is not what
 * comq is doing to it.
 *
 * @param {(channel: import('@toa.io/amqplib').Channel) => Promise<unknown>} manage
 */
async function managing (manage) {
  const connection = await amqplib.connect(url(0))
  const channel = await connection.createChannel()

  try {
    await manage(channel)
  } finally {
    await channel.close().catch(noop)
    await connection.close().catch(noop)
  }
}

/**
 * @param {number} broker
 * @returns {string}
 */
function url (broker) {
  return `amqp://${USER}:${PASSWORD}@${getAddress(broker)}`
}

/** @type {Set<string>} the queues a scenario has declared as they used to be */
const legacy = new Set()

/** What the broker is given to drop a queue in, past its expiry. */
const DEADLINE = 5000

function noop () {}
