'use strict'

const { AssertionError } = require('node:assert')
const { generate } = require('randomstring')
const { promex, timeout } = require('@toa.io/generic')
const { dump } = require('@toa.io/yaml')
const tomato = require('@toa.io/tomato')
const { io } = require('./io.mock')
const mock = { tomato }

jest.mock('@cucumber/cucumber', () => mock.tomato)

require('../rpc')

/** @type {comq.features.Context} */
let context

const queue = generate()

beforeEach(() => {
  jest.clearAllMocks()

  context = /** @type {comq.features.Context} */ { io }
})

describe('Given function replying {token} queue:', () => {
  const step = tomato.steps.Gi('function replying {token} queue:')

  it('should be', () => undefined)

  it('should assign given function as producer', async () => {
    const javascript = '({ a, b }) => a + b'

    await step.call(context, queue, javascript)

    expect(io.reply).toHaveBeenCalledWith(queue, expect.any(Function))

    const producer = io.reply.mock.calls[0][1]
    const sum = producer({ a: 1, b: 2 })

    expect(sum).toStrictEqual(3)
  })
})

describe('Given a producer replying {token} queue', () => {
  const step = tomato.steps.Gi('a producer replying {token} queue')

  it('should be', async () => undefined)

  it('should reply', async () => {
    await step.call(context, queue)

    expect(io.reply).toHaveBeenCalledWith(queue, expect.any(Function))

    const producer = io.reply.mock.calls[0][1]
    const message = generate()
    const reply = await producer(message)

    expect(reply).toStrictEqual(message)
  })
})

describe('Given function replying {token} queue is expected:', () => {
  tomato.steps.Gi('function replying {token} queue is expected:')

  it('should be', () => undefined)
})

describe('When the consumer sends the following request to the {token} queue:', () => {
  const step = tomato.steps.Wh('the consumer sends the following request to the {token} queue:')

  it('should be', async () => undefined)

  const payload = { [generate()]: generate() }
  const yaml = dump(payload)

  beforeEach(async () => {
    await step.call(context, queue, yaml)
  })

  it('should send request', async () => {
    expect(io.request).toHaveBeenCalledWith(queue, payload)
  })

  it('should store reply promise', async () => {
    const reply = await io.request.mock.results[0].value

    expect(await context.reply).toStrictEqual(reply)
  })

  it('should wait for context.expected', async () => {
    context.expected = promex()

    let completed = false

    setImmediate(() => {
      expect(completed).toStrictEqual(false)

      completed = true

      context.expected.resolve()
    })

    await step.call(context, queue, yaml)

    expect(completed).toStrictEqual(true)
  })
})

describe('When the consumer sends a request to the {token} queue', () => {
  const step = tomato.steps.Wh('the consumer sends a request to the {token} queue')

  it('should be', async () => undefined)

  it('should send request', async () => {
    await step.call(context, queue)

    expect(io.request).toHaveBeenCalledWith(queue, expect.any(Buffer))
  })
})

describe('Then the consumer receives the reply:', () => {
  const step = tomato.steps.Th('the consumer receives the reply:')

  it('should be', async () => undefined)

  const replies = [
    ['primitive', generate()],
    ['object', { ok: 1 }],
    ['array', [1, 'foo']]
  ]

  describe.each(replies)('%s reply comparison', (type, value) => {
    let yaml

    beforeEach(() => {
      yaml = dump(value)
    })

    it('should throw if differ', async () => {
      const promise = promex()

      context.reply = promise
      promise.resolve(generate())

      await expect(step.call(context, yaml)).rejects.toThrow(AssertionError)
    })

    it('should pass if equals', async () => {
      const promise = promex()

      context.reply = promise

      promise.resolve(value)

      await expect(step.call(context, yaml)).resolves.not.toThrow()
    })
  })
})

describe('Then the consumer receives the reply', () => {
  const step = tomato.steps.Th('the consumer receives the reply')

  it('should be', async () => undefined)

  it('should await reply', async () => {
    context.reply = promex()

    let completed = false

    setImmediate(() => {
      expect(completed).toStrictEqual(false)

      context.reply.resolve()

      completed = true
    })

    await step.call(context)

    expect(completed).toStrictEqual(true)
  })
})

describe('Then the consumer does not receive the reply', () => {
  const step = tomato.steps.Th('the consumer does not receive the reply')

  it('should be', async () => undefined)

  it('should throw if reply is received within 50ms', async () => {
    context.reply = promex()

    setTimeout(() => {
      context.reply.resolve(generate())
    }, 10)

    await expect(step.call(context)).rejects.toThrow(AssertionError)
  })

  it('should not throw if reply is not received', async () => {
    await expect(step.call(context)).resolves.not.toThrow(AssertionError)
  })
})

describe('Given I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz', () => {
  const step = tomato.steps.Gi('I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz')

  it('should be', async () => undefined)

  it('should send requests continuously', async () => {
    context = /** @type {comq.features.Context} */  {
      io: /** @type {jest.MockedObject<comq.IO>} */ { request: jest.fn() },
      requestsSent: []
    }

    const bytesQ = '1k'
    const queue = generate()
    const frequencyQ = '100'

    step.call(context, bytesQ, queue, frequencyQ)

    await timeout(100 + 12)

    const callsAmountExpected = [10, 11, 12]

    expect(callsAmountExpected).toContain(context.io.request.mock.calls.length)
    expect(context.sending).toBeDefined()
    expect(callsAmountExpected).toContain(context.requestsSent.length)

    clearInterval(context.sending)
  })
})

describe('Then all replies have been received', () => {
  const step = tomato.steps.Th('all replies have been received')

  /** @type {jest.MockedObject<comq.features.Context>} */
  let context

  it('should be', async () => undefined)

  beforeEach(async () => {
    context = /** @type {jest.MockedObject<comq.features.Context>} */ {
      requestsSent: [promex(), promex()]
    }
  })

  it('should pass if replies received', async () => {
    let completed = false

    setImmediate(() => {
      completed = true

      for (const promise of context.requestsSent) promise.resolve()
    })

    await step.call(context)

    expect(completed).toStrictEqual(true)
  })
})
