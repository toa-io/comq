'use strict'

const { World } = require('@cucumber/cucumber')
const { connect, assert } = require('../../')
const { getAddress, USER, PASSWORD } = require('./brokers')

/**
 * @implements {comq.features.Context}
 */
class Context extends World {
  io
  connected = false
  connecting
  requestsSent = []
  reply
  consumed = {}
  published
  eventsPublishedCount = 0
  eventsConsumedCount = 0
  events = {}
  processed
  enqueued
  tasksProcessedCount = 0
  exception
  expected
  sharded
  shard
  sealing
  stream
  streamValues = []
  streamEnded = false
  streams = {}
  streamsValues = {}
  streamsEnded = {}
  generatorDestroyed = false

  /** @type {comq.features.Network[]} */
  networks = []

  async connect (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls)
  }

  async assert (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls, assert)
  }

  async unplug () {
    await Promise.all(this.networks.map((network) => network.close()))

    this.networks = []
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
   * @param {comq.Connect} [method]
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
    const address = this.networks[i]?.address ?? getAddress(i)
    const url = PROTOCOL + user + ':' + password + '@' + address
    const heartbeat = global.COMQ_TESTING_AMQP_HEARTBEAT

    // the watchdog measures silence, so it may only be shortened along with the
    // interval at which a healthy broker is expected to say something
    return heartbeat === undefined ? url : url + '?heartbeat=' + heartbeat
  }
}

const PROTOCOL = 'amqp://'

/** @type {comq.diagnostics.Event[]} */
const EVENTS = ['open', 'close', 'flow', 'discard']

exports.Context = Context
