'use strict'

const assert = require('node:assert')
const amqplib = require('@toa.io/amqplib')
const { Given, When, Then } = require('@cucumber/cucumber')

const { getAddress, USER, PASSWORD } = require('./brokers')
const { timeout } = require('../../test/helpers')

Given('(that )groupless events from the {token} exchange are causing exceptions',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    await this.io.consume(exchange, (payload, properties) => {
      this.attempts.push(properties.headers?.['x-comq-attempt'] ?? 1)

      throw new Error('Expected exception')
    })
  })

When('the connection is closed',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.disconnect()
  })

Then('a message parked from the {token} exchange is in the parking queue',
  /**
   * @param {string} exchange
   * @this {comq.features.Context}
   */
  async function (exchange) {
    await reading(async (channel) => {
      const message = await pick(channel,
        (one) => one.properties.headers?.['x-comq-exchange'] === exchange)

      assert.notEqual(message, undefined,
        `Nothing in '${PARKED}' came from the '${exchange}' exchange`)

      const headers = message.properties.headers

      // a groupless subscriber consumes a name the broker chose, so what is asserted
      // here is that the message says which queue, not which name that is
      assert.notEqual(headers['x-comq-queue'], undefined,
        'The parked message does not name the queue it came from')

      assert.notEqual(headers['x-comq-reason'], undefined, 'The parked message has no reason')

      channel.nack(message, false, true)
    })
  })

/**
 * Runs `read` against a connection of its own, so that what it does to the parking
 * queue is not what comq is doing to it.
 *
 * @param {(channel: import('@toa.io/amqplib').Channel) => Promise<void>} read
 */
async function reading (read) {
  const connection = await amqplib.connect(`amqp://${USER}:${PASSWORD}@${getAddress(0)}`)
  const channel = await connection.createChannel()

  try {
    await read(channel)
  } finally {
    await channel.close().catch(noop)
    await connection.close().catch(noop)
  }
}

/**
 * The first message in the parking queue that `matches`, waited for. One queue holds what
 * every scenario before this one left in it, so everything that does not match is given
 * back; the match is left unacknowledged, for the caller to take or to return.
 *
 * @param {import('@toa.io/amqplib').Channel} channel
 * @param {(message: import('@toa.io/amqplib').GetMessage) => boolean} matches
 * @returns {Promise<import('@toa.io/amqplib').GetMessage | undefined>}
 */
async function pick (channel, matches) {
  const deadline = Date.now() + DEADLINE

  do {
    const taken = []

    let delivery

    while ((delivery = await channel.get(PARKED, { noAck: false })) !== false) taken.push(delivery)

    const match = taken.find(matches)

    for (const one of taken) if (one !== match) channel.nack(one, false, true)

    if (match !== undefined) return match

    await timeout(50)
  } while (Date.now() < deadline)
}

const PARKED = 'comq.parked'

/** The ladder the suite runs on is half a second; this is room for it and the broker. */
const DEADLINE = 5000

function noop () {}

exports.PARKED = PARKED
exports.reading = reading
exports.pick = pick
