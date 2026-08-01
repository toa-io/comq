'use strict'

const { generate } = require('randomstring')

const mock = require('./connection.mock')
const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

const queue = generate()
const payload = { [generate()]: generate() }

beforeEach(() => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

it('should reject when request times out', async () => {
  await expect(io.request(queue, payload, 50)).rejects.toMatchObject({
    message: expect.stringContaining('timed out'),
    code: 'ETIMEDOUT'
  })
})

it('should reject when request times out with encoding', async () => {
  await expect(io.request(queue, payload, 'application/json', 50)).rejects.toMatchObject({
    code: 'ETIMEDOUT'
  })
})
