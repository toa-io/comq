'use strict'

const { AssertionError } = require('node:assert')
const { generate } = require('randomstring')
const { random, quantity } = require('@toa.io/generic')
const tomato = require('@toa.io/tomato')
const { io } = require('./io.mock')
const mock = { tomato }

jest.mock('@cucumber/cucumber', () => mock.tomato)

require('../backpressure')

/** @type {comq.features.Context} */
let context

describe('When I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz for {number} second(s)', () => {
  const step = tomato.steps.Wh('I\'m sending {quantity}B requests to the {token} queue at {quantity}Hz for {number} second(s)')

  it('should be', async () => undefined)

  const bytesQ = (random(5) + 1) + 'k'
  const frequencyQ = String((random(5) + 1) / 10) + 'k' // not too high
  const seconds = (random(3) + 1) / 10
  const queue = generate()

  const bytes = quantity(bytesQ)
  const frequency = quantity(frequencyQ)

  beforeAll(async () => {
    jest.clearAllMocks()

    context = /** @type {comq.features.Context} */ { io }

    await step.call(context, bytesQ, queue, frequencyQ, seconds)
  })

  it('should send request', async () => {
    expect(io.request).toHaveBeenCalled()
  })

  it('should sent request to specified queue', async () => {
    const call = io.request.mock.calls[0]

    expect(call[0]).toStrictEqual(queue)
  })

  it('should send buffer of given size', async () => {
    const buffer = io.request.mock.calls[0][1]

    expect(Buffer.byteLength(buffer)).toStrictEqual(bytes)
  })

  it('should send expected amount of requests', async () => {
    const times = Math.ceil(seconds * frequency)

    expect(io.request).toHaveBeenCalledTimes(times)
  })
})

describe('Then back pressure was applied', () => {
  const step = tomato.steps.Th('back pressure was applied')

  beforeEach(() => {
    context = /** @type {comq.features.Context} */ { io }
  })

  it('should be', async () => undefined)

  it('should fail if flag is not set', async () => {
    expect(() => step.call(context)).toThrow(AssertionError)
  })

  it('should pass if flag is true', async () => {
    context.events = { flow: true }

    expect(() => step.call(context)).not.toThrow()
  })
})
