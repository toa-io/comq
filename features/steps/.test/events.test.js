'use strict'

const { AssertionError } = require('node:assert')
const { randomBytes } = require('node:crypto')
const { generate } = require('randomstring')
const { promex, timeout, random } = require('@toa.io/generic')
const tomato = require('@toa.io/tomato')
const { dump } = require('@toa.io/yaml')
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

    expect(context.consumed[group]).toStrictEqual(expect.objectContaining({ payload }))
  })

  it('should store event properties', async () => {
    const payload = generate()
    const properties = generate()

    await consumer(payload, properties)

    expect(context.consumed[group]).toStrictEqual({ payload, properties })
  })
})

describe('Given {token} consuming events from the {token} exchange is expected', () => {
  tomato.steps.Gi('{token} consuming events from the {token} exchange is expected')

  it('should be', async () => undefined)
})

describe('Given (that )events are exclusively consumed from the {token} exchange', () => {
  tomato.steps.Gi('(that )events are exclusively consumed from the {token} exchange')

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
    expect(io.emit.mock.calls[0][0]).toStrictEqual(exchange)
  })

  it('should wait for context.expected', async () => {
    jest.clearAllMocks()

    context.consumptionPromise = promex()

    let resolved = false

    setImmediate(() => {
      expect(io.emit).not.toHaveBeenCalled()

      resolved = true
      context.consumptionPromise.resolve()
    })

    await step.call(context, exchange)

    expect(io.emit).toHaveBeenCalled()
    expect(resolved).toStrictEqual(true)
  })
})

describe('When an event is emitted to the {token} exchange with properties:', () => {
  const step = tomato.steps.Wh('an event is emitted to the {token} exchange with properties:')

  it('should be', async () => undefined)

  const exchange = generate()
  const properties = { [generate()]: generate() }
  const yaml = dump(properties)

  beforeEach(async () => {
    await step.call(context, exchange, yaml)
  })

  it('should store event', async () => {
    expect(context.published).toBeDefined()
  })

  it('should emit event', async () => {
    expect(io.emit).toHaveBeenCalledWith(exchange, expect.anything(), properties)
  })
})

describe('Then {token} receives the event', () => {
  const step = tomato.steps.Th('{token} receives the event')

  const payload = randomBytes(8)
  const group = generate()

  beforeEach(() => {
    context.consumed = { [group]: { payload } }
  })

  it('should be', async () => undefined)

  it('should throw if not consumed', async () => {
    context.published = randomBytes(8)

    await expect(step.call(context, group)).rejects.toThrow(AssertionError)
  })

  it('should pass if consumed', async () => {
    context.published = payload

    await expect(step.call(context, group)).resolves.not.toThrow()
  })
})

describe('Then {token} receives the event with properties:', () => {
  const step = tomato.steps.Th('{token} receives the event with properties:')

  it('should be', async () => undefined)

  const payload = randomBytes(8)
  const properties = { headers: { [generate()]: generate() } }
  const yaml = dump(properties)
  const group = generate()

  beforeEach(() => {
    context.consumed = { [group]: { payload, properties } }
    context.published = payload
  })

  it('should throw if does not match', async () => {
    const properties = { headers: { [generate()]: generate() } }
    const yaml = dump(properties)

    await expect(step.call(context, group, yaml)).rejects.toThrow(AssertionError)
  })

  it('should pass if matches', async () => {
    await expect(step.call(context, group, yaml)).resolves.not.toThrow()
  })
})

describe('Then the event is received', () => {
  const step = tomato.steps.Th('the event is received')

  const payload = randomBytes(8)
  const group = undefined

  beforeEach(() => {
    context.consumed = { [group]: { payload } }
  })

  it('should be', async () => undefined)

  it('should throw if not consumed', async () => {
    context.published = randomBytes(8)

    await expect(step.call(context, group)).rejects.toThrow(AssertionError)
  })

  it('should pass if consumed', async () => {
    context.published = payload

    await expect(step.call(context, group)).resolves.not.toThrow()
  })
})


describe('Given I\'m publishing {quantity}B events to the {token} exchange at {quantity}Hz', () => {
  const step = tomato.steps.Gi('I\'m publishing {quantity}B events to the {token} exchange at {quantity}Hz')

  it('should be', async () => undefined)

  it('should publish events continuously', async () => {
    context = /** @type {comq.features.Context} */  {
      io: /** @type {jest.MockedObject<comq.IO>} */ { emit: jest.fn() },
      requestsSent: [],
      eventsPublishedCount: 0
    }

    const bytesQ = '1k'
    const exchange = generate()
    const frequencyQ = '100'

    step.call(context, bytesQ, exchange, frequencyQ)

    await timeout(100 + 12)

    const callsAmountExpected = [10, 11]

    expect(callsAmountExpected).toContain(context.io.emit.mock.calls.length)
    expect(context.publishing).toBeDefined()
    expect(callsAmountExpected).toContain(context.eventsPublishedCount)

    clearInterval(context.publishing)
  })
})

describe('Then all events have been received', () => {
  const step = tomato.steps.Th('all events have been received')

  /** @type {jest.MockedObject<comq.features.Context>} */
  let context

  it('should be', async () => undefined)

  beforeEach(async () => {
    context = /** @type {jest.MockedObject<comq.features.Context>} */ {
      eventsPublishedCount: random(100),
      eventsConsumedCount: 100 + random()
    }
  })

  it('should pass if events received', async () => {
    context.eventsConsumedCount = context.eventsPublishedCount

    await expect(step.call(context)).resolves.not.toThrow()
  })

  it('should fail if events are not received', async () => {
    await expect(step.call(context)).rejects.toThrow(AssertionError)
  })

  it('should wait for last events (50ms)', async () => {
    setTimeout(() => {
      context.eventsConsumedCount = context.eventsPublishedCount
    }, 49)

    await expect(step.call(context)).resolves.not.toThrow()
  })
})
