'use strict'

const { generate } = require('randomstring')

jest.mock('../source/io')
jest.mock('../source/connection')
jest.mock('../source/shards/connection')

const { connect } = require('../')
const { IO } = require('../source/io')

const {
  /** @type {jest.MockedClass<comq.Connection>} */
  Connection
} = require('../source/connection')

const shards = /** @type {{ Connection: jest.MockedClass<comq.Connection>}} */
  require('../source/shards')

it('should be', async () => {
  expect(connect).toBeDefined()
})

const url = generate()

/** @type {comq.IO} */
let io

beforeEach(() => {
  jest.clearAllMocks()
})

describe('single connection', () => {
  beforeEach(async () => {
    io = await connect(url)
  })

  it('should return IO', async () => {
    expect(io).toBeInstanceOf(IO)
  })

  it('should pass active connection', async () => {
    expect(Connection).toHaveBeenCalledWith(url, {})

    /** @type {jest.MockedObject<comq.Connection>} */
    const instance = Connection.mock.instances[0]

    expect(instance.open).toHaveBeenCalled()
    expect(IO).toHaveBeenCalledWith(instance)
  })
})

describe('sharded connection', () => {
  const urls = [generate(), generate()]

  beforeEach(async () => {
    io = await connect(...urls)
  })

  it('should create sharded connection', async () => {
    expect(shards.Connection).toHaveBeenCalled()
  })

  it('should pass single connection instances', async () => {
    urls.forEach((url) => expect(Connection).toHaveBeenCalledWith(url, {}))

    const instances = Connection.mock.instances

    expect(shards.Connection).toHaveBeenCalledWith(instances)
  })
})

describe('topology overrides', () => {
  it('should pass the trailing argument to the connection', async () => {
    const overrides = { event: { delay: 100 } }

    await connect(url, overrides)

    expect(Connection).toHaveBeenCalledWith(url, overrides)
  })

  it('should pass them to every shard', async () => {
    const urls = [generate(), generate()]
    const overrides = { request: { attempts: 1 } }

    await connect(...urls, overrides)

    urls.forEach((url) => expect(Connection).toHaveBeenCalledWith(url, overrides))
    expect(shards.Connection).toHaveBeenCalled()
  })

  it('should not take a url as overrides', async () => {
    const urls = [generate(), generate()]

    await connect(...urls)

    expect(Connection).toHaveBeenCalledTimes(2)
    urls.forEach((url) => expect(Connection).toHaveBeenCalledWith(url, {}))
  })
})
