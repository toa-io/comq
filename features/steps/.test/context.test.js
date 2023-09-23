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
})

describe.each([false, true])('connect (shards: %s)', (sharded) => {
  it('should be', async () => {
    expect(context.connect).toBeDefined()
  })

  /** @type {jest.MockedObject<comq.IO>} */
  let io

  beforeEach(async () => {
    context.sharded = sharded

    await context.connect()

    io = await comq.connect.mock.results[0].value
  })

  it('should connect', async () => {
    const shards = ['amqp://developer:secret@localhost:5673', 'amqp://developer:secret@localhost:5674']

    if (sharded) expect(comq.connect).toHaveBeenCalledWith(...shards)
    else expect(comq.connect).toHaveBeenCalledWith(shards[0])
  })

  it('should connect with credentials', async () => {
    const user = generate()
    const password = generate()

    await context.connect(user, password)

    const shards = [`amqp://${user}:${password}@localhost:5673`, `amqp://${user}:${password}@localhost:5674`]

    if (sharded) expect(comq.connect).toHaveBeenCalledWith(...shards)
    else expect(comq.connect).toHaveBeenCalledWith(shards[0])
  })

  it.each(['open', 'close', 'flow', 'discard'])('should store %s event',
    /**
     * @param {comq.diagnostics.Event} event
     */
    async (event) => {
      expect(io.diagnose).toHaveBeenCalledWith(event, expect.any(Function))
      expect(context.events[event]).not.toStrictEqual(true)

      const listener = io.diagnose.mock.calls.find((call) => call[0] === event)[1]

      listener()

      expect(context.events[event]).toStrictEqual(true)
    })
})
