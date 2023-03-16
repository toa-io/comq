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
}

class Connection extends EventEmitter {
  constructor () {
    super()

    // noinspection JSValidateTypes
    this.removeAllListeners = jest.spyOn(this, 'removeAllListeners')

    // noinspection JSValidateTypes
    this.on = jest.spyOn(this, 'on')
  }

  createChannel = jest.fn(async () => new Channel())
  createConfirmChannel = jest.fn(async () => new Channel())
  close = jest.fn(async () => undefined)
}

/** @type {jest.MockedObject<import('amqplib')>} */
const amqplib = {
  connect: jest.fn(async () => new Connection())
}

exports.amqplib = amqplib
