// noinspection JSCheckFunctionSignatures

'use strict'

const { EventEmitter } = require('node:events')
const { generate } = require('randomstring')

class Channel extends EventEmitter {
  prefetch = jest.fn(() => undefined)
  consume = jest.fn(async () => ({ consumerTag: generate() }))
  cancel = jest.fn(async () => undefined)
  ack = jest.fn(() => undefined)
  nack = jest.fn(() => undefined)
  assertQueue = jest.fn(async (name) => ({ queue: name ?? generate() }))
  assertExchange = jest.fn(async () => undefined)
  bindQueue = jest.fn(async () => undefined)
  publish = jest.fn((_0, _1, _2, _3, resolve) => resolve?.(null))
  close = jest.fn(async () => undefined)
}

class Connection extends EventEmitter {
  constructor (url = '') {
    super()

    const stream = new EventEmitter()

    // amqplib listens for 'error' and 'end' on the socket only, so destroying it
    // without an error leaves the connection unaware and silent forever
    stream.destroy = jest.fn((error) => {
      if (error === undefined || stream.destroyed === true) return

      stream.destroyed = true

      this.emit('error', error)
      this.emit('close', error)
    })

    // a broker accepts the heartbeat the client asks for
    const heartbeat = Number(/[?&]heartbeat=(\d+)/.exec(url)?.[1] ?? 60)

    // and negotiates the channel limit down to whatever the client asked for
    const channelMax = Number(/[?&]channelMax=(\d+)/.exec(url)?.[1] ?? 2047)

    this.connection = { stream, heartbeat, channelMax }

    // noinspection JSValidateTypes
    this.removeAllListeners = jest.spyOn(this, 'removeAllListeners')

    // noinspection JSValidateTypes
    this.on = jest.spyOn(this, 'on')
  }

  createChannel = jest.fn(async () => new Channel())
  createConfirmChannel = jest.fn(async () => new Channel())
  close = jest.fn(async () => undefined)
}

const connect = async (url) => new Connection(url)

/** @type {jest.MockedObject<import('amqplib')>} */
const amqplib = {
  connect: jest.fn(connect)
}

exports.amqplib = amqplib
exports.connect = connect
