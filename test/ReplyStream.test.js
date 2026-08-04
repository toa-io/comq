'use strict'

const { EventEmitter } = require('node:events')
const { once } = require('node:events')
const { ReplyStream, UNCONFIRMED } = require('../source/.io/ReplyStream')
const { control } = require('../source/.io/const')

/** @type {jest.Mock} */
let reply

/** @type {ReplyStream} */
let stream

beforeEach(() => {
  global.COMQ_TESTING_MAX_BUFFER_SIZE = 3
  global.COMQ_TESTING_IDLE_INTERVAL = 60_000

  reply = jest.fn().mockResolvedValue(true)

  const request = {
    emitter: new EventEmitter(),
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
    emitter: new EventEmitter(),
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
