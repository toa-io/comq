'use strict'

const { generate } = require('randomstring')

jest.mock('../source/io')
jest.mock('../source/singleton')
jest.mock('../source/shards/connection')

const { /** @type {jest.MockedClass<comq.IO>} */ IO } = require('../source/io')

const {
  /** @type {jest.MockedClass<comq.Connection>} */
  SingletonConnection
} = require('../source/singleton')

const shards = /** @type {{ Connection: jest.MockedClass<comq.Connection>}} */
  require('../source/shards')

const { assert } = require('../')

const url = generate()

/** @type {comq.IO} */
let io

beforeEach(async () => {
  jest.clearAllMocks()

  io = await assert(url)
})

it('should be', async () => {
  expect(assert).toBeInstanceOf(Function)
})

it('should return instance of IO', async () => {
  expect(io).toStrictEqual(IO.mock.instances[0])
})

it('should create singleton connection', async () => {
  expect(SingletonConnection).toHaveBeenCalled()
  expect(SingletonConnection).toHaveBeenCalledWith(url)
  expect(IO).toHaveBeenCalledWith(SingletonConnection.mock.instances[0])
})

it('should create sharded connection', async () => {
  jest.clearAllMocks()

  const urls = [generate(), generate()]

  io = await assert(...urls)

  for (const url of urls) expect(SingletonConnection).toHaveBeenCalledWith(url)

  expect(shards.Connection).toHaveBeenCalledWith(SingletonConnection.mock.instances)
  expect(IO).toHaveBeenCalledWith(shards.Connection.mock.instances[0])
  expect(io).toStrictEqual(IO.mock.instances[0])
})
