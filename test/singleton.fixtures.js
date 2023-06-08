'use strict'

class Connection {
  static ctor = jest.fn(async () => undefined)
  static open = jest.fn(async () => undefined)
  static close = jest.fn(async () => undefined)

  constructor (...args) {
    Connection.ctor(...args)
  }

  async open () {
    await Connection.open()
  }

  async close () {
    await Connection.close()
  }
}

exports.mock = { Connection }
