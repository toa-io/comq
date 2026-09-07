'use strict'

const { Readable } = require('node:stream')
const { Promex } = require('promex')
const { ReplyPipe } = require('../source/.io/ReplyPipe')
const { createReplyEmitter } = require('../source/.io/createReplyEmitter')
const { control, FLOW_HEADER } = require('../source/.io/const')
const { timeout } = require('./helpers')

/** @type {jest.Mock} */
let reply

/** @type {[any, comq.amqp.options.Publish][]} */
let sent

let channel

/** @type {comq.ReplyEmitter} */
let feedback

let request

beforeEach(() => {
  global.COMQ_TESTING_HEARTBEAT_INTERVAL = 60_000

  sent = []
  reply = jest.fn(async (message, properties) => {
    sent.push([message, properties])

    return true
  })

  channel = { diagnose: jest.fn(), forget: jest.fn() }
  feedback = createReplyEmitter('control')
  request = { properties: { correlationId: 'test-correlation', replyTo: 'replies' } }
})

afterEach(() => {
  delete global.COMQ_TESTING_HEARTBEAT_INTERVAL
})

const messages = () => sent.map(([message]) => message)

const closing = (pipe) => new Promise((resolve) => pipe.on('close', resolve))

it('should confirm, announcing flow control', async () => {
  const pipe = await ReplyPipe.create(request, Readable.from([]), channel, feedback, reply)

  expect(sent[0][0]).toStrictEqual(control.ok)
  expect(sent[0][1].headers).toStrictEqual({ index: 0, [FLOW_HEADER]: true })

  await closing(pipe)
})

it('should transmit values in order, then end', async () => {
  const pipe = await ReplyPipe.create(request, Readable.from([1, 2, 3]), channel, feedback, reply)

  await closing(pipe)

  expect(messages()).toStrictEqual([control.ok, 1, 2, 3, control.end])
  expect(sent.map(([, properties]) => properties.headers.index)).toStrictEqual([0, 1, 2, 3, 4])
})

// a source listened to runs at its own pace, and its output piles up in front of a paused channel
it('should pull the source no faster than the channel takes', async () => {
  const gate = new Promex()

  let pulled = 0

  reply.mockImplementation(async (message) => {
    if (message !== control.ok) await gate

    return true
  })

  function * source () {
    for (let i = 0; i < 100; i++) {
      pulled++

      yield i
    }
  }

  const pipe = await ReplyPipe.create(request, Readable.from(source()), channel, feedback, reply)

  await timeout(10)

  // a Readable reads ahead by no more than its high water mark
  expect(pulled).toBeLessThanOrEqual(20)

  gate.resolve()

  await closing(pipe)

  expect(pulled).toStrictEqual(100)
})

it('should hold the source while the consumer has asked for a pause', async () => {
  const pipe = await ReplyPipe.create(request, Readable.from([1, 2, 3]), channel, feedback, reply)

  feedback.emit(request.properties.correlationId, control.pause, {})

  await timeout(10)

  expect(messages()).toStrictEqual([control.ok])

  feedback.emit(request.properties.correlationId, control.resume, {})

  await closing(pipe)

  expect(messages()).toStrictEqual([control.ok, 1, 2, 3, control.end])
})

it('should stop once the consumer has ended the stream', async () => {
  const gate = new Promex()

  reply.mockImplementation(async (message, properties) => {
    sent.push([message, properties])

    if (message !== control.ok) await gate

    return true
  })

  const pipe = await ReplyPipe.create(request, Readable.from([1, 2, 3]), channel, feedback, reply)
  const closed = closing(pipe)

  feedback.emit(request.properties.correlationId, control.end, {})

  await closed

  gate.resolve()

  await timeout(10)

  expect(messages()).not.toContain(control.end)
  expect(messages()).not.toContain(3)
  expect(channel.forget).toHaveBeenCalledWith('return', expect.any(Function))
  expect(feedback.pending).toStrictEqual(0)
})

it('should not heartbeat once the confirmation could not be delivered', async () => {
  global.COMQ_TESTING_HEARTBEAT_INTERVAL = 5

  reply.mockImplementation(async (message, properties) => {
    sent.push([message, properties])

    return false
  })

  const pipe = new ReplyPipe(request, Readable.from([1]), channel, feedback, reply)

  await pipe.pipe()
  await timeout(30)

  expect(messages()).toStrictEqual([control.ok])
})

it('should heartbeat while idle', async () => {
  global.COMQ_TESTING_HEARTBEAT_INTERVAL = 5

  const source = new Readable({ objectMode: true, read () {} })
  const pipe = await ReplyPipe.create(request, source, channel, feedback, reply)

  await timeout(30)

  expect(messages()).toContain(control.heartbeat)

  pipe.destroy()
})
