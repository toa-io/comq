'use strict'

const { AssertionError } = require('node:assert')
const { generate } = require('randomstring')
const { random, promex } = require('@toa.io/generic')
const tomato = require('@toa.io/tomato')
const { comq } = require('./comq.mock')
const world = require('./context.mock')
const mock = { tomato, comq }

jest.mock('@cucumber/cucumber', () => mock.tomato)
jest.mock('comq', () => mock.comq)

require('../connection')

/** @type {jest.MockedObject<comq.features.Context>} */
let context

beforeEach(() => {
  jest.clearAllMocks()

  context = world.context()
})

describe('Given an active connection to the broker', () => {
  const step = tomato.steps.Gi('an active connection to the broker')

  it('should be', async () => undefined)

  beforeEach(async () => {
    await step.call(context)
  })

  it('should connect', async () => {
    expect(context.connect).toHaveBeenCalled()
  })

  it('should store promise', async () => {
    expect(context.connecting).toBeInstanceOf(Promise)
  })
})

describe('Given an active sharded connection', () => {
  const step = tomato.steps.Gi('an active sharded connection')

  it('should be', async () => undefined)

  beforeEach(async () => {
    await step.call(context)
  })

  it('should set sharded to true', async () => {
    expect(context.sharded).toStrictEqual(true)
  })

  it('should connect', async () => {
    expect(context.connect).toHaveBeenCalled()
  })

  it('should store promise', async () => {
    expect(context.connecting).toStrictEqual(expect.any(Promise))
  })
})

describe('When I attempt to connect to the broker for {number} second(s)', () => {
  const step = tomato.steps.Wh('I attempt to connect to the broker for {number} second(s)')

  it('should be', async () => undefined)

  const interval = (random(2) + 1) / 10

  describe('broker available', () => {
    beforeEach(async () => {
      await step.call(context, interval)
    })

    it('should call connect', async () => {
      expect(context.connect).toHaveBeenCalled()
    })
  })

  describe('broker unavailable', () => {
    /** @type {toa.generic.Promex} */
    let connection

    beforeEach(() => {
      connection = promex()

      context.connect.mockImplementationOnce(async () => connection)
    })

    it('should quit after given interval', async () => {
      const start = new Date().getTime()

      await step.call(context, interval)

      const end = new Date().getTime()
      const inaccuracy = 1 // setTimeout is inaccurate

      expect(end - start + inaccuracy).toBeGreaterThanOrEqual(interval * 1000)
    })
  })

  describe('exceptions', () => {
    it('should catch exception', async () => {
      const exception = new Error(generate())

      context.connect.mockImplementationOnce(async () => { throw exception })

      await step.call(context, interval)

      expect(context.exception).toStrictEqual(exception)
    })
  })
})

describe('When I attempt to connect to the broker', () => {
  const step = tomato.steps.Wh('I attempt to connect to the broker')

  it('should be', async () => undefined)

  it('should connect', async () => {
    await step.call(context)

    expect(context.connect).toHaveBeenCalled()
  })

  it('should store exception', async () => {
    const exception = new Error(generate())

    context.connect.mockImplementationOnce(async () => { throw exception })

    await step.call(context)

    expect(context.exception).toStrictEqual(exception)
  })
})

describe('When I attempt to connect to the broker as {string} with password {string}', () => {
  const step = tomato.steps.Wh('I attempt to connect to the broker as {string} with password {string}')

  it('should be', async () => undefined)

  const user = generate()
  const password = generate()

  it('should connect with credentials', async () => {
    await step.call(context, user, password)

    expect(context.connect).toHaveBeenCalledWith(user, password)
  })
})

describe('When I attempt to establish sharded connection', () => {
  const step = tomato.steps.Wh('I attempt to establish sharded connection')

  it('should be', async () => undefined)

  it('should set context.sharded to true', async () => {
    await step.call(context)

    expect(context.sharded).toStrictEqual(true)
  })

  it('should connect', async () => {
    await step.call(context)

    expect(context.connect).toHaveBeenCalled()
  })
})

describe('When I attempt to establish a sharded connection as {string} with password {string}', () => {
  const step = tomato.steps.Wh('I attempt to establish a sharded connection as {string} with password {string}')

  it('should be', async () => undefined)

  const user = generate()
  const password = generate()

  it('should connect with credentials', async () => {
    await step.call(context, user, password)

    expect(context.sharded).toStrictEqual(true)
    expect(context.connect).toHaveBeenCalledWith(user, password)
  })
})

describe.each([['', true], [' not', false]])('Then the connection is%s established',
  (not, connected) => {
    const step = tomato.steps.Th(`the connection is${not} established`)

    it('should be', async () => undefined)

    it(`should fail if is${connected ? 'n\'t' : ''} connected`, async () => {
      context.connected = !connected

      await expect(step.call(context)).rejects.toThrow(AssertionError)
    })

    it(`should pass if is${connected ? '' : 'n\'t'} connected`, async () => {
      context.connected = connected

      await expect(step.call(context)).resolves.not.toThrow()
    })
  })

describe('Then no exceptions are thrown', () => {
  const step = tomato.steps.Th('no exceptions are thrown')

  it('should be', async () => undefined)

  it(`should fail if exception is defined`, async () => {
    context.exception = new Error()

    expect(() => step.call(context)).toThrow(AssertionError)
  })

  it(`should pass if exception isn't defined`, async () => {
    expect(() => step.call(context)).not.toThrow()
  })
})

describe('Then an exception is thrown: {string}', () => {
  const step = tomato.steps.Th('an exception is thrown: {string}')

  const message = generate()

  it('should be', async () => undefined)

  it(`should pass if exception is defined and message matches`, async () => {
    context.exception = new Error(message)

    const slice = message.slice(2, 6)

    expect(() => step.call(context, slice)).not.toThrow()
  })

  it(`should fail if exception isn't defined`, async () => {
    expect(() => step.call(context)).toThrow(AssertionError)
  })

  it('should fail if message doesn\'t match', async () => {
    context.exception = new Error(generate())

    expect(() => step.call(context)).toThrow(AssertionError)
  })
})

describe('Given the connection has started sealing', () => {
  const step = tomato.steps.Gi('the connection has started sealing')

  it('should be', async () => undefined)

  it('should seal the connection', async () => {
    context.io = /** @type {jest.MockedObject<comq.IO>} */ {
      seal: jest.fn(async () => undefined)
    }

    await step.call(context)

    expect(context.io.seal).toHaveBeenCalled()
    expect(context.sealing).toBeInstanceOf(Promise)
  })
})

describe('Then the connection is sealed', () => {
  const step = tomato.steps.Th('the connection is sealed')

  it('should be', async () => undefined)

  it('should await for sealing', async () => {
    context.sealing = promex()

    let sealed = false

    setImmediate(() => {
      context.sealing.resolve()
      sealed = true
    })

    await step.call(context)

    expect(sealed).toStrictEqual(true)
  })
})
