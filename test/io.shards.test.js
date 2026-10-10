'use strict'

const { generate } = require('randomstring')
const { immediate } = require('./helpers')
const { encode } = require('../source/encode')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

/** @type {jest.MockedObject<comq.Channel>} */
let requests

/** @type {jest.MockedObject<comq.Channel>} */
let replies

/** @type {(index: number) => boolean} */
let occupied

let promise

const findChannel = (type) => {
  const index = connection.createChannel.mock.calls.findIndex(([t]) => (t === type))

  return connection.createChannel.mock.results[index].value
}

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection(true)
  io = new IO(connection)
  promise = io.request(generate(), { [generate()]: generate() })

  await immediate()

  requests = await findChannel('request')
  replies = await findChannel('reply')
  occupied = requests.occupy.mock.calls[0][0]
})

it('should tell the request channel which shards owe a Reply', async () => {
  expect(requests.occupy).toHaveBeenCalledWith(expect.any(Function))
})

it('should say so of the shard an unanswered Request went through', async () => {
  expect(occupied(0)).toStrictEqual(true)
})

it('should not say so of another shard', async () => {
  expect(occupied(1)).toStrictEqual(false)
})

it('should not say so once the Request is answered', async () => {
  const { correlationId, contentType } = requests.send.mock.calls[0][2]
  const consumer = replies.consume.mock.calls[0][1]

  consumer({ content: encode(generate(), contentType), properties: { correlationId, contentType } })

  await promise

  expect(occupied(0)).toStrictEqual(false)
})

it('should not tell a channel that is not sharded', async () => {
  connection = mock.connection()
  connection.createChannel.mockImplementation(async (type, index) => {
    const channel = mock.channel(false, index)

    delete channel.occupy

    return channel
  })

  io = new IO(connection)

  expect(() => io.request(generate(), generate())).not.toThrow()

  await immediate()
})
