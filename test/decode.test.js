'use strict'

const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { pack } = require('msgpackr')

const { decode } = require('../source/decode')

it('should be', async () => {
  expect(decode).toBeDefined()
})

it('should decode application/json', async () => {
  const object = { [generate()]: generate() }
  const json = JSON.stringify(object)
  const content = Buffer.from(json)
  const contentType = 'application/json'
  const properties = { contentType }
  const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties }

  const decoded = decode(message)

  expect(decoded).toStrictEqual(object)
})

it('should decode application/msgpack', async () => {
  const object = { [generate()]: generate() }
  const content = pack(object)
  const contentType = 'application/msgpack'
  const properties = { contentType }
  const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties }

  const decoded = decode(message)

  expect(decoded).toStrictEqual(object)
})

it('should return buffer if content type is not defined', async () => {
  const object = { [generate()]: generate() }
  const json = JSON.stringify(object)
  const content = Buffer.from(json)
  const properties = {}
  const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties }

  const buffer = decode(message)
  const string = buffer.toString()
  const decoded = JSON.parse(string)

  expect(decoded).toStrictEqual(object)
})

it('should return buffer if content type is application/octet-stream', async () => {
  const object = { [generate()]: generate() }
  const json = JSON.stringify(object)
  const content = Buffer.from(json)
  const contentType = 'application/octet-stream'
  const properties = { contentType }
  const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties }

  const buffer = decode(message)
  const string = buffer.toString()
  const decoded = JSON.parse(string)

  expect(decoded).toStrictEqual(object)
})

it('should throw if content-type is not supported', async () => {
  const content = randomBytes(8)
  const contentType = 'wtf/' + generate()
  const properties = { contentType }
  const message = /** @type {import('amqplib').ConsumeMessage} */ { content, properties }

  expect(() => decode(message)).toThrow('is not supported')
})
