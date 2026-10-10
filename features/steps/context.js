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
  attempts = []
  counts = {}
  parked = {}
  awaited
  answer
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

  /** @type {Record<string, string>} the address each name of a shard resolves to */
  names = {}

  /** @type {comq.shards.Timing} */
  resolution = { interval: 50, settle: 300, linger: 600 }

  /** @type {Record<'join' | 'retire' | 'leave', string[]>} the addresses of the brokers that did */
  brokers = { join: [], retire: [], leave: [] }

  async connect (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls)
  }

  async assert (user, password) {
    const urls = this.#urls(user, password)

    await this.#connect(urls, assert)
  }

  /**
   * Connects to the names of the shards, which a broker is found behind at whatever port the
   * names are given: see `names.js`.
   *
   * @param {string[]} hosts
   * @param {number} port
   */
  async connectNames (hosts, port) {
    const urls = hosts.map((host) => PROTOCOL + USER + ':' + PASSWORD + '@' + host + ':' + port)

    await this.#connect(urls, connect, { ...TOPOLOGY, resolution: this.resolution })

    for (const event of Object.keys(this.brokers)) {
      this.io.diagnose(event, (_index, address) => this.brokers[event].push(address))
    }
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
    this.attempts = []
    this.counts = {}
    this.parked = {}
    this.awaited = undefined
    this.answer = undefined
  }

  /**
   * @param {string[]} urls
   * @param {comq.Connect} [method]
   * @param {comq.Options} [options]
   * @return {Promise<void>}
   */
  async #connect (urls, method = connect, options = TOPOLOGY) {
    if (this.io !== undefined) await this.disconnect()

    // the retry delay is a topology setting, so the suite need not wait out a
    // production one to see the mechanism work
    this.io = await method(...urls, options)
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
    const query = []

    // a connection gone silent is told by its missing heartbeats, so a short one tells it soon
    if (global.COMQ_TESTING_AMQP_HEARTBEAT !== undefined) {
      query.push('heartbeat=' + global.COMQ_TESTING_AMQP_HEARTBEAT)
    }

    // a broker negotiates the channel limit down to what the client asks for,
    // which is how exhaustion is reached without opening two thousand channels
    if (global.COMQ_TESTING_AMQP_CHANNEL_MAX !== undefined) {
      query.push('channelMax=' + global.COMQ_TESTING_AMQP_CHANNEL_MAX)
    }

    return query.length === 0 ? url : url + '?' + query.join('&')
  }
}

const PROTOCOL = 'amqp://'

/** @type {comq.diagnostics.Event[]} */
const EVENTS = ['open', 'close', 'flow', 'discard', 'retry', 'pause', 'resume', 'exhausted']

/** @type {comq.topology.Overrides} */
// as many rungs as the presets have, so the suite exercises the shipped attempt count,
// at a wall clock it can wait out
const LADDER = [50, 100, 150, 200]

/** @type {comq.topology.Overrides} */
const TOPOLOGY = { event: { delay: LADDER }, request: { delay: LADDER } }

exports.Context = Context
