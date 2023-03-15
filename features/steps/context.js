'use strict'

const { World } = require('@cucumber/cucumber')
const { connect } = require('../../')

/**
 * @implements {comq.features.Context}
 */
class Context extends World {
  /** @type {comq.IO} */
  static io
  static url

  io
  connecting
  reply
  consumed
  published
  events = {}
  exception
  expected

  async connect (user, password) {
    const url = locator(user, password)

    if (url !== Context.url) await this.#connect(url)

    this.io = Context.io

    for (const event of EVENTS) this.io.diagnose(event, () => (this.events[event] = true))
  }

  async #connect (url) {
    if (Context.url !== undefined) await Context.disconnect()

    Context.url = url
    Context.io = await connect(url)
  }

  static async disconnect () {
    if (Context.io === undefined) return

    await Context.io.close()

    Context.io = undefined
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
