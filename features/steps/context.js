'use strict'

const { World } = require('@cucumber/cucumber')
const { connect } = require('../../')

/**
 * @implements {comq.features.Context}
 */
class Context extends World {
  io
  connected = false
  connecting
  reply
  consumed
  published
  events = {}
  exception
  expected

  async connect (user, password) {
    const url = locator(user, password)

    await this.#connect(url)
  }

  async disconnect () {
    if (this.io === undefined) return

    await this.io.close()

    this.io = undefined
    this.connected = false
    this.events = {}
  }

  /**
   * @param {string} url
   * @return {Promise<void>}
   */
  async #connect (url) {
    if (this.io !== undefined) await this.disconnect()

    this.io = await connect(url)
    this.connected = true

    for (const event of EVENTS) this.io.diagnose(event, () => (this.events[event] = true))

    this.io.diagnose('close', () => (this.connected = false))
    this.io.diagnose('open', () => (this.connected = true))
  }
}

const locator = (user, password) => {
  if (user === undefined) {
    user = USER
    password = PASSWORD
  }

  return PROTOCOL + user + ':' + password + '@' + HOST
}

const PROTOCOL = 'amqp://'
const HOST = 'localhost:5673'
const USER = 'developer'
const PASSWORD = 'secret'

/** @type {comq.diagnostics.event[]} */
const EVENTS = ['open', 'close', 'flow', 'discard']

exports.Context = Context
