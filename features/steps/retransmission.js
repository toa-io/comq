'use strict'

const assert = require('node:assert')
const { Promex } = require('promex')
const { Given, When, Then, After } = require('@cucumber/cucumber')

const { connect } = require('../../')
const { getAddress, USER, PASSWORD, BROKERS_AMOUNT } = require('./brokers')
const { timeout, until } = require('../../test/helpers')

Given('a producer on another connection counting the requests to the {token} queue, answering when told',
  /**
   * Connected to every broker directly, so that nothing done to the consumer's network reaches it.
   * It takes every Request as it comes, counts how many times it has been handed each of them, and
   * holds the replies back until it is told to answer: whatever the consumer re-sends by then is
   * counted, however quickly the first attempt would have been answered.
   *
   * @param {string} queue
   * @this {comq.features.Context}
   */
  async function (queue) {
    const urls = Array.from({ length: BROKERS_AMOUNT }, (_, n) =>
      `amqp://${USER}:${PASSWORD}@${getAddress(n)}`)

    this.producer = await connect(...urls)
    this.executions = new Map()
    this.answering = new Promex()

    await this.producer.reply(queue, async ({ id }) => {
      this.executions.set(id, (this.executions.get(id) ?? 0) + 1)

      await this.answering

      return id
    })
  })

When('the producer answers',
  /**
   * @this {comq.features.Context}
   */
  function () {
    this.answering.resolve()
  })

When('the consumer sends {number} numbered requests to the {token} queue',
  /**
   * @param {number} amount
   * @param {string} queue
   * @this {comq.features.Context}
   */
  function (amount, queue) {
    this.numbered = Array.from({ length: amount }, (_, id) => {
      const reply = this.io.request(queue, { id })

      // asserted on by a later step, and an unhandled rejection would end the run before it
      reply.catch(() => undefined)

      return reply
    })
  })

When('the consumer\'s connection to broker {number} is cut',
  /**
   * The broker is taken away from the consumer alone: the connection closes at both ends, and the
   * consumer is refused until it is restored. Returns once the consumer has noticed, so that what
   * it sends next goes to the other broker.
   *
   * @param {number} broker
   * @this {comq.features.Context}
   */
  async function (broker) {
    let lost = false

    this.io.diagnose('close', (_error, index) => { if (index === broker) lost = true })
    this.networks[broker].cut()

    assert.equal(await until(() => lost, 10_000), true,
      `The consumer's connection to broker ${broker} was not lost`)
  })

When('the consumer\'s connection to broker {number} is restored',
  /**
   * Returns once the consumer's channels to that broker have recovered, which is when the
   * requests it may have lost with it are re-sent.
   *
   * @param {number} broker
   * @this {comq.features.Context}
   */
  async function (broker) {
    const recovered = new Set()

    this.io.diagnose('recover', (type, index) => { if (index === broker) recovered.add(type) })
    this.networks[broker].admit()

    const restored = () => recovered.has('request') && recovered.has('reply')

    assert.equal(await until(restored, 20_000), true,
      `The consumer's channels to broker ${broker} have not recovered`)
  })

When('the consumer\'s network to broker {number} goes silent',
  /**
   * @param {number} broker
   * @this {comq.features.Context}
   */
  function (broker) {
    this.networks[broker].silence()
  })

Then('every numbered request is answered within {number} seconds',
  /**
   * @param {number} seconds
   * @this {comq.features.Context}
   */
  async function (seconds) {
    const answered = new Array(this.numbered.length).fill(false)

    this.numbered.forEach((reply, id) => reply.then(() => { answered[id] = true }, () => undefined))

    await until(() => answered.every(Boolean), seconds * 1000)

    const unanswered = answered.flatMap((yes, id) => yes ? [] : [id])

    assert.deepEqual(unanswered, [], `Requests ${unanswered.join(', ')} are not answered`)

    for (const [id, reply] of this.numbered.entries()) assert.equal(await reply, id, 'Reply mismatch')
  })

Then('every numbered request has been executed {word}',
  /**
   * A re-sent Request is taken as soon as it arrives, so a moment is given for any copy still on
   * its way to the producer to be counted.
   *
   * @param {'once' | 'twice'} times
   * @this {comq.features.Context}
   */
  async function (times) {
    const expected = TIMES[times]

    await timeout(SETTLE_MS)

    const executed = this.numbered.map((_, id) => this.executions.get(id) ?? 0)
    const wrong = executed.flatMap((count, id) => count === expected ? [] : [`${id}: ${count}`])

    assert.deepEqual(wrong, [], `Requests executed other than ${times} (id: times): ${wrong.join(', ')}`)
  })

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    this.answering?.resolve()
    await this.producer?.close()

    this.producer = undefined
    this.executions = undefined
    this.answering = undefined
    this.numbered = undefined
  })

const TIMES = { once: 1, twice: 2 }

const SETTLE_MS = 1000
