'use strict'

const { generate } = require('randomstring')
const { comq } = require('./comq.mock')
const mock = { comq }

jest.mock('comq', () => mock.comq)

const { Context } = require('../context')

it('should be', async () => {
  expect(Context).toBeDefined()
})

/** @type {comq.features.Context} */
let context

beforeAll(async () => {
  const _ = {}

  // noinspection JSValidateTypes
  context = new Context(_)

  await context.connect()
})

describe('connect', () => {
  it('should be', async () => {
    expect(context.connect).toBeDefined()
  })

  /** @type {jest.MockedObject<comq.IO>} */
  let io

  beforeEach(async () => {
    io = await comq.connect.mock.results[0].value
  })

  it('should connect', async () => {
    expect(comq.connect).toHaveBeenCalledWith('amqp://developer:secret@localhost:5673')
  })

  it('should not connect twice', async () => {
    await context.connect()

    expect(comq.connect).toHaveBeenCalledTimes(1)
  })

  it('should reconnect with credentials', async () => {
    const user = generate()
    const password = generate()

    await context.connect(user, password)

    expect(io.close).toHaveBeenCalled()

    expect(comq.connect).toHaveBeenCalledTimes(2)
    expect(comq.connect).toHaveBeenCalledWith(`amqp://${user}:${password}@localhost:5673`)
  })

  it.each(['open', 'close', 'flow', 'discard'])('should store %s event',
    /**
     * @param {comq.diagnostics.event} event
     */
    async (event) => {
      expect(io.diagnose).toHaveBeenCalledWith(event, expect.any(Function))
      expect(context.events[event]).not.toStrictEqual(true)

      const listener = io.diagnose.mock.calls.find((call) => call[0] === event)[1]

      listener()

      expect(context.events[event]).toStrictEqual(true)
    })
})
