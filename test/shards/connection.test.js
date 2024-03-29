'use strict'

const { generate } = require('randomstring')
const { random, promex, immediate } = require('@toa.io/generic')

const { Connection } = require('../../source/shards')

const mock = require('../connection.mock')

jest.mock('../../source/shards/channel')

const { create } = require('../../source/shards/channel')

it('should be', async () => {
  expect(Connection).toBeDefined()
})

/** @type {jest.MockedObject<comq.Connection>[]} */
let connections

/** @type {comq.Connection} */
let connection

beforeEach(() => {
  jest.clearAllMocks()

  connections = [mock.connection(), mock.connection()]
  connection = new Connection(connections)
})

describe('open', () => {
  it('should resolve when all of the connections are established', async () => {
    expect.assertions(2)

    /** @type {toa.generic.Promex[]} */
    const promises = []

    for (const conn of connections) {
      const promise = promex()

      conn.open.mockImplementation(() => promise)
      promises.push(promise)
    }

    let resolved = false

    setImmediate(async () => {
      expect(resolved).toStrictEqual(false)

      const first = promises.shift()

      first.resolve()

      await immediate()

      promises.forEach((promise) => promise.resolve())

      resolved = true
    })

    await connection.open()

    expect(resolved).toStrictEqual(true)
  })

  it('should close opened connection if one fails', async () => {
    connections.push(mock.connection())

    const [one, bad, two] = connections
    const exception = new Error(generate())

    one.open.mockImplementation(() => Promise.resolve())
    two.open.mockImplementation(() => Promise.resolve())

    bad.open.mockImplementation(async () => {
      await immediate()
      throw exception
    })

    await expect(connection.open()).rejects.toThrow(exception)

    expect(one.close).toHaveBeenCalled()
    expect(two.close).toHaveBeenCalled()
  })
})

describe('close', () => {
  it('should close all connections', async () => {
    await connection.close()

    for (const conn of connections) {
      expect(conn.close).toHaveBeenCalled()
    }
  })
})

describe('createChannel', () => {
  const type = generate()

  beforeEach(() => {
    connection.createChannel(type)
  })

  it('should create channel', async () => {
    expect(create).toHaveBeenCalledWith(connections, type)
  })
})

describe.each(/** @type {comq.diagnostics.Event[]} */ ['open', 'close'])('diagnose %s event',
  (event) => {
    it('should re-emit event', async () => {
      const index = random(connections.length)

      for (const conn of connections) {
        expect(conn.diagnose).toHaveBeenCalledWith(event, expect.any(Function))
      }

      const listener = /** @type {Function} */ jest.fn()

      connection.diagnose(event, listener)

      const call = connections[index].diagnose.mock.calls.find(
        (call) => call[0] === event)

      const emit = call[1]
      const args = [generate(), generate()]

      emit(event, ...args)

      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith(event, ...args, index)
    })
  })
