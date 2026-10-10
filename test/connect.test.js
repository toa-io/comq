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

  it('should pass the urls, and what makes a connection to a broker', async () => {
    expect(shards.Connection).toHaveBeenCalledWith(urls, expect.any(Function), undefined)

    const make = shards.Connection.mock.calls[0][1]
    const servername = generate()
    const instance = make(urls[0], servername)

    expect(Connection).toHaveBeenCalledWith(urls[0], {}, servername)
    expect(instance).toStrictEqual(Connection.mock.instances[0])
  })

  it('should not connect by itself', async () => {
    expect(Connection).not.toHaveBeenCalled()
  })
})

describe('ranges', () => {
  it('should expand a range into the urls of a sharded connection', async () => {
    await connect('amqp://rmq[0..3].example.com')

    const expanded = ['amqp://rmq0.example.com', 'amqp://rmq1.example.com', 'amqp://rmq2.example.com']

    expect(shards.Connection).toHaveBeenCalledWith(expanded, expect.any(Function), undefined)
  })

  it('should connect to a range of one as to a single url', async () => {
    await connect('amqp://rmq[0..1].example.com')

    expect(Connection).toHaveBeenCalledWith('amqp://rmq0.example.com', {})
    expect(shards.Connection).not.toHaveBeenCalled()
  })
})

describe('resolution', () => {
  it('should pass how the names are followed, apart from the overrides', async () => {
    const urls = [generate(), generate()]
    const resolution = { interval: 1, settle: 2, linger: 3 }
    const overrides = { event: { delay: 100 } }

    await connect(...urls, { ...overrides, resolution })

    expect(shards.Connection).toHaveBeenCalledWith(urls, expect.any(Function), resolution)

    shards.Connection.mock.calls[0][1](urls[0])

    expect(Connection).toHaveBeenCalledWith(urls[0], overrides, undefined)
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

    const make = shards.Connection.mock.calls[0][1]

    urls.forEach((url) => make(url))
    urls.forEach((url) => expect(Connection).toHaveBeenCalledWith(url, overrides, undefined))
  })

  it('should not take a url as overrides', async () => {
    const urls = [generate(), generate()]

    await connect(...urls)

    expect(shards.Connection).toHaveBeenCalledWith(urls, expect.any(Function), undefined)
  })
})
