'use strict'

const { generate } = require('randomstring')
const { random, promex, sample } = require('@toa.io/generic')

const { Connection } = require('../../source/shards')

const mock = require('../connection.mock')

jest.mock('../../source/shards/channel')

const { create } = require('../../source/shards/channel')

it('should be', async () => {
  expect(Connection).toBeDefined()
})

/** @type {jest.MockedObject<comq.Connection>[]} */
const connections = [mock.connection(), mock.connection()]

/** @type {comq.Connection} */
let connection

beforeEach(() => {
  jest.clearAllMocks()

  connection = new Connection(connections)
})

describe('open', () => {
  it('should resolve when one of connections is established', async () => {
    expect.assertions(1)

    /** @type {toa.generic.Promex[]} */
    const promises = []

    for (const conn of connections) {
      const promise = promex()

      conn.open.mockImplementation(() => promise)
      promises.push(promise)
    }

    let connected = false

    setImmediate(() => {
      expect(connected).toStrictEqual(false)

      const any = sample(promises)

      any.resolve()
    })

    await connection.open()

    connected = true
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

describe.each(/** @type {comq.diagnostics.event[]} */ ['open', 'close'])('diagnose %s event',
  (event) => {
    const index = random(connections.length)

    it('should re-emit event', async () => {
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
