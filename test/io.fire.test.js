'use strict'

// region setup

const { generate } = require('randomstring')

const mock = require('./connection.mock')
const { IO } = require('../source/io')
const { encode } = require('../source/encode')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

const queue = generate()
const payload = { [generate()]: generate() }

/** @type {jest.MockedObject<comq.Channel>} */
let channel

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)

  await io.fire(queue, payload)

  channel = await connection.createChannel.mock.results[0].value
})

// endregion

it('should be', async () => {
  expect(io.fire).toBeInstanceOf(Function)
})

it('should create request channel', async () => {
  expect(connection.createChannel).toHaveBeenCalledWith('request')
})

it('should send a message to a queue', async () => {
  expect(channel.send).toHaveBeenCalled()
  expect(channel.send.mock.calls[0][0]).toStrictEqual(queue)
})

it('should encode messages with msgpack by default', async () => {
  const contentType = 'application/msgpack'
  const buffer = encode(payload, contentType)

  expect(channel.send).toHaveBeenCalledWith(
    queue,
    buffer,
    expect.objectContaining({ contentType })
  )
})

it('should encode with specified encoding', async () => {
  jest.clearAllMocks()

  const contentType = 'application/json'
  const buffer = encode(payload, contentType)

  await io.fire(queue, buffer, contentType)

  expect(channel.send).toHaveBeenCalledWith(
    queue,
    buffer,
    expect.objectContaining({ contentType })
  )
})
