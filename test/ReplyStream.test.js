'use strict'

const { once } = require('node:events')
const { ReplyStream, UNCONFIRMED } = require('../source/.io/ReplyStream')
const { createReplyEmitter } = require('../source/.io/createReplyEmitter')
const { control, FLOW_HEADER } = require('../source/.io/const')

/** @type {jest.Mock} */
let reply

/** @type {ReplyStream} */
let stream

beforeEach(() => {
  global.COMQ_TESTING_MAX_BUFFER_SIZE = 3
  global.COMQ_TESTING_IDLE_INTERVAL = 60_000

  reply = jest.fn().mockResolvedValue(true)

  const request = {
    emitter: createReplyEmitter('test'),
    properties: { correlationId: 'test-correlation' }
  }

  stream = new ReplyStream(request, reply)
})

afterEach(() => {
  delete global.COMQ_TESTING_MAX_BUFFER_SIZE
  delete global.COMQ_TESTING_IDLE_INTERVAL

  stream.destroy()
})

it('should destroy without calling reply when buffer overflows before control.ok', async () => {
  const closed = once(stream, 'close')

  for (let index = 1; index <= 5; index++) {
    stream.arrange(index, { headers: { index } })
  }

  await closed

  expect(stream.destroyed).toBe(true)
  expect(reply).not.toHaveBeenCalled()
})

it('should reject confirmation when buffer overflows before control.ok', async () => {
  for (let index = 1; index <= 5; index++) {
    stream.arrange(index, { headers: { index } })
  }

  await expect(stream.confirmation).rejects.toThrow(UNCONFIRMED)
})

it('should reject confirmation when destroyed before control.ok', async () => {
  stream.destroy()

  await expect(stream.confirmation).rejects.toThrow(UNCONFIRMED)
})

it('should reject confirmation when nothing arrives within the idle interval', async () => {
  global.COMQ_TESTING_IDLE_INTERVAL = 10

  const request = {
    emitter: createReplyEmitter('test'),
    properties: { correlationId: 'idle-correlation' }
  }

  const idle = new ReplyStream(request, reply)

  await expect(idle.confirmation).rejects.toThrow(UNCONFIRMED)
})

it('should keep confirmation resolved after control.ok', async () => {
  stream.arrange(control.ok, { headers: { index: 0 }, type: 'control' })

  await expect(stream.confirmation).resolves.toBeUndefined()

  stream.destroy()

  await expect(stream.confirmation).resolves.toBeUndefined()
})

describe('flow', () => {
  const TOTAL = 40 // well beyond the 16 values a Readable holds in object mode

  /**
   * @param {boolean} flow whether the producer honours pause and resume
   */
  const ok = (flow) => ({ headers: { index: 0, [FLOW_HEADER]: flow }, type: 'control' })

  const send = () => {
    for (let index = 1; index <= TOTAL; index++) stream.arrange(index, { headers: { index } })

    stream.arrange(control.end, { headers: { index: TOTAL + 1 }, type: 'control' })
  }

  // dropping the listener once behind would leave the stream waiting for values that have passed
  it('should keep receiving while the consumer is behind', async () => {
    stream.arrange(control.ok, ok(false))
    send()

    const received = []

    for await (const value of stream) received.push(value)

    expect(received).toHaveLength(TOTAL)
    expect(received[TOTAL - 1]).toStrictEqual(TOTAL)
  })

  it('should not ask a producer that knows nothing of pause', async () => {
    stream.arrange(control.ok, ok(false))
    send()

    expect(reply).not.toHaveBeenCalled()
  })

  it('should ask the producer to pause once behind, and to resume once caught up', async () => {
    stream.arrange(control.ok, ok(true))

    for (let index = 1; index <= TOTAL; index++) stream.arrange(index, { headers: { index } })

    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith({ properties: ok(true) }, control.pause)

    const drained = new Promise((resolve) => stream.on('data', (value) => { if (value === TOTAL) resolve() }))

    await drained

    expect(reply).toHaveBeenCalledTimes(2)
    expect(reply).toHaveBeenLastCalledWith({ properties: ok(true) }, control.resume)
  })

  it('should bound the values held out of order by their size', async () => {
    global.COMQ_TESTING_MAX_BUFFER_SIZE = 1000
    global.COMQ_TESTING_MAX_BUFFER_BYTES = 100

    try {
      const request = {
        emitter: createReplyEmitter('test'),
        properties: { correlationId: 'bytes-correlation' }
      }

      const held = new ReplyStream(request, reply)
      const closed = once(held, 'close')

      held.arrange(1, { headers: { index: 1 } }, 60)

      expect(held.destroyed).toBe(false)

      held.arrange(2, { headers: { index: 2 } }, 60)

      await closed

      expect(held.destroyed).toBe(true)
    } finally {
      delete global.COMQ_TESTING_MAX_BUFFER_BYTES
    }
  })
})
