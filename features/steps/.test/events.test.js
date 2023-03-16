'use strict'

const { AssertionError } = require('node:assert')
const { generate } = require('randomstring')
const { promex } = require('@toa.io/generic')
const tomato = require('@toa.io/tomato')
const { io } = require('./io.mock')
const mock = { tomato }

jest.mock('@cucumber/cucumber', () => mock.tomato)

require('../events')

/** @type {comq.features.Context} */
let context

beforeEach(() => {
  jest.clearAllMocks()

  context = /** @type {comq.features.Context} */ { io }
})

describe('Given (that ){token} is consuming events from the {token} exchange', () => {
  const step = tomato.steps.Gi('(that ){token} is consuming events from the {token} exchange')

  it('should be', async () => undefined)

  const exchange = generate()
  const group = generate()

  let consumer

  beforeEach(async () => {
    await step.call(context, group, exchange)

    consumer = io.consume.mock.calls[0]?.[2]

    expect(consumer).toBeInstanceOf(Function)
  })

  it('should consume', async () => {
    expect(io.consume).toHaveBeenCalledTimes(1)
  })

  it('should store event in context', async () => {
    const payload = generate()

    await consumer(payload)

    expect(context.consumed[group]).toStrictEqual(payload)
  })
})

describe('Given {token} consuming events from the {token} exchange is expected', () => {
  tomato.steps.Gi('{token} consuming events from the {token} exchange is expected')

  it('should be', async () => undefined)
})

describe('Given that events are exclusively consumed from the {token} exchange', () => {
  tomato.steps.Gi('that events are exclusively consumed from the {token} exchange')

  it('should be', async () => undefined)
})

describe('When an event is emitted to the {token} exchange', () => {
  const step = tomato.steps.Wh('an event is emitted to the {token} exchange')

  it('should be', async () => undefined)

  const exchange = generate()

  beforeEach(async () => {
    await step.call(context, exchange)
  })

  it('should store event', async () => {
    expect(context.published).toBeDefined()
  })

  it('should emit event', async () => {
    expect(io.emit).toHaveBeenCalledWith(exchange, expect.anything())
  })

  it('should wait for context.expected', async () => {
    jest.clearAllMocks()

    context.expected = promex()

    let resolved = false

    setImmediate(() => {
      expect(io.emit).not.toHaveBeenCalled()

      resolved = true
      context.expected.resolve()
    })

    await step.call(context, exchange)

    expect(io.emit).toHaveBeenCalled()
    expect(resolved).toStrictEqual(true)
  })
})

describe('Then {token} receives the event', () => {
  const step = tomato.steps.Th('{token} receives the event')

  const payload = generate()
  const group = generate()

  beforeEach(() => {
    context.consumed = { [group]: payload }
  })

  it('should be', async () => undefined)

  it('should throw if not consumed', async () => {
    context.published = generate()

    await expect(step.call(context, group)).rejects.toThrow(AssertionError)
  })

  it('should pass if consumed', async () => {
    context.published = payload

    await expect(step.call(context, group)).resolves.not.toThrow()
  })
})

describe('Then the event is received', () => {
  const step = tomato.steps.Th('the event is received')

  const payload = generate()
  const group = undefined

  beforeEach(() => {
    context.consumed = { [group]: payload }
  })

  it('should be', async () => undefined)

  it('should throw if not consumed', async () => {
    context.published = generate()

    await expect(step.call(context, group)).rejects.toThrow(AssertionError)
  })

  it('should pass if consumed', async () => {
    context.published = payload

    await expect(step.call(context, group)).resolves.not.toThrow()
  })
})
