'use strict'

const { World } = require('@cucumber/cucumber')
const { connect, assert } = require('../../')

/**
 * @implements {comq.features.Context}
 */
class Context extends World {
  io
  connected = false
  connecting
  requestsSent = []
  reply
  consumed
  published
  eventsPublishedCount = 0
  eventsConsumedCount = 0
  events = {}
  exception
  expected
  sharded
  shard
  sealing
  stream
  streamValues = []
  streamEnded = false
  generatorDestroyed = false

  async connect (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls)
  }

  async assert (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls, assert)
  }

  async disconnect () {
    if (this.io === undefined) return

    await this.io.close()

    this.io = undefined
    this.connected = false
    this.events = {}
  }

  /**
   * @param {string[]} urls
   * @param {comq.connect} [method]
   * @return {Promise<void>}
   */
  async #connect (urls, method = connect) {
    if (this.io !== undefined) await this.disconnect()

    this.io = await method(...urls)
    this.connected = true

    for (const event of EVENTS) this.io.diagnose(event, () => (this.events[event] = true))

    this.io.diagnose('close', () => (this.connected = false))
    this.io.diagnose('open', () => (this.connected = true))
  }

  #urls (user, password) {
    if (user === undefined) {
      user = USER
      password = PASSWORD
    }

    const urls = []

    urls.push(this.#url(0, user, password))

    if (this.sharded) urls.push(this.#url(1, user, password))

    return urls
  }

  #url (i, user, password) {
    return PROTOCOL + user + ':' + password + '@' + SHARDS[i]
  }
}

const PROTOCOL = 'amqp://'
const SHARDS = ['localhost:5673', 'localhost:5674']
const USER = 'developer'
const PASSWORD = 'secret'

/** @type {comq.diagnostics.event[]} */
const EVENTS = ['open', 'close', 'flow', 'discard']

exports.Context = Context
