'use strict'

const { generate } = require('randomstring')

const io = /** @type {jest.MockedObject<comq.IO>} */ {
  reply: jest.fn(async () => undefined),
  request: jest.fn(async () => generate()),
  consume: jest.fn(async () => generate()),
  emit: jest.fn(async () => generate()),
  close: jest.fn(async () => undefined),
  diagnose: jest.fn(() => undefined)
}

exports.io = io
