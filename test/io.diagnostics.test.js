'use strict'

const { generate } = require('randomstring')

const mock = require('./connection.mock')

const { IO } = require('../source/io')

/** @type {comq.IO} */
let io

/** @type {jest.MockedObject<comq.Connection>} */
let connection

beforeEach(async () => {
  jest.clearAllMocks()

  connection = mock.connection()
  io = new IO(connection)
})

it('should be', async () => {
  expect(io.diagnose).toBeDefined()
})

describe.each(['request', 'reply', 'event'])('%s channel events',
  /**
   * @param {comq.topology.type} type
   */
  (type) => {
    it.each(['flow', 'drain', 'recover', 'discard', 'pause', 'resume'])('should re-emit %s',
      /**
       * @param {comq.diagnostics.Event} event
       */
      async (event) => {
        const listener = /** @type {Function} */ jest.fn()

        io.diagnose(event, listener)

        // create channels
        await io.reply(generate(), () => undefined)
        await io.consume(generate(), generate(), () => undefined)

        const channel = await findChannel(type)

        expect(channel.diagnose).toHaveBeenCalledWith(event, expect.any(Function))

        const emit = channel.diagnose.mock.calls.find((call) => call[0] === event)[1]
        const args = [generate(), generate()]

        emit(...args)

        expect(listener).toHaveBeenCalledWith(type, ...args)
      })
  })

it.each(['open', 'close'])('should re-emit %s from connection',
  /**
   * @param {comq.diagnostics.Event} event
   */
  async (event) => {
    const listener = /** @type {Function} */ jest.fn(() => undefined)

    expect(connection.diagnose).toHaveBeenCalledWith(event, expect.any(Function))

    const call = connection.diagnose.mock.calls.find((call) => call[0] === event)
    const emit = call[1]

    io.diagnose(event, listener)

    const args = [generate(), generate()]

    emit(...args)

    expect(listener).toHaveBeenCalledWith(...args)
  })

/**
 * @param {comq.topology.type} type
 * @returns {jest.MockedObject<comq.Channel>}
 */
const findChannel = (type) => {
  const index = connection.createChannel.mock.calls.findIndex(([t]) => (t === type))

  if (index === -1) throw new Error(`${type} channel hasn't been created`)

  return connection.createChannel.mock.results[index].value
}
