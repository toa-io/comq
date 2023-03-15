'use strict'

const { generate } = require('randomstring')

const { connect } = require('../')

jest.mock('../source/io')
jest.mock('../source/connection')

const { IO } = require('../source/io')

const {
  /** @type {jest.MockedClass<comq.Connection>} */
  Connection
} = require('../source/connection')

it('should be', async () => {
  expect(connect).toBeDefined()
})

const url = generate()

/** @type {comq.IO} */
let io

beforeEach(async () => {
  jest.clearAllMocks()

  io = await connect(url)
})

it('should return IO', async () => {
  expect(io).toBeInstanceOf(IO)
})

it('should pass active connection', async () => {
  expect(Connection).toHaveBeenCalledWith(url)

  /** @type {jest.MockedObject<comq.Connection>} */
  const instance = Connection.mock.instances[0]

  expect(instance.open).toHaveBeenCalled()
  expect(IO).toHaveBeenCalledWith(instance)
})
