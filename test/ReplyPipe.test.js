'use strict'

const { Readable } = require('node:stream')
const { Promex } = require('../source/promex')
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
  // the pause is asked for while the confirmation is still being published: the pipe does not
  // read its source until that has been published, so nothing can be in flight yet
  const opening = ReplyPipe.create(request, Readable.from([1, 2, 3]), channel, feedback, reply)

  feedback.emit(request.properties.correlationId, control.pause, {})

  const pipe = await opening

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

// the confirmation is published before the source is read, and a blocked broker holds the publish
// for as long as it is blocked: the source may fail in the meantime, and nobody listens to it yet
it('should survive a source that fails before the confirmation is sent', async () => {
  const gate = new Promex()

  reply.mockImplementation(async (message, properties) => {
    sent.push([message, properties])
    await gate

    return true
  })

  const source = new Readable({ objectMode: true, read () {} })
  const creating = ReplyPipe.create(request, source, channel, feedback, reply)

  source.destroy(new Error('nothing arrived'))

  await timeout(10)

  gate.resolve()

  const pipe = await creating

  await closing(pipe)

  expect(source.destroyed).toStrictEqual(true)
})

it('should destroy the source if the confirmation cannot be sent', async () => {
  reply.mockImplementation(async () => {
    throw new Error('channel closed')
  })

  const source = new Readable({ objectMode: true, read () {} })

  await expect(ReplyPipe.create(request, source, channel, feedback, reply)).rejects.toThrow('channel closed')

  expect(source.destroyed).toStrictEqual(true)
})

describe('batches', () => {
  beforeEach(() => {
    request.properties.contentType = 'application/json'
  })

  it('should send the values its source holds as one message', async () => {
    const pipe = await ReplyPipe.create(request, Readable.from([1, 2, 3]), channel, feedback, reply)

    await closing(pipe)

    expect(messages()).toStrictEqual([control.ok, [1, 2, 3], control.end])
    expect(sent[1][1].type).toStrictEqual('batch')
  })

  it('should send each value that arrives on its own as it arrives', async () => {
    async function * source () {
      yield 1
      await timeout(10)
      yield 2
    }

    const pipe = await ReplyPipe.create(request, Readable.from(source()), channel, feedback, reply)

    await closing(pipe)

    expect(messages()).toStrictEqual([control.ok, 1, 2, control.end])
    expect(sent[1][1].type).toBeUndefined()
  })

  it('should send buffers as one message, each prefixed with its length', async () => {
    const source = Readable.from([Buffer.from('ab'), Buffer.from('cde')])
    const pipe = await ReplyPipe.create(request, source, channel, feedback, reply)

    await closing(pipe)

    const expected = Buffer.from([0, 0, 0, 2, 0x61, 0x62, 0, 0, 0, 3, 0x63, 0x64, 0x65])

    expect(messages()[1]).toStrictEqual(expected)
    expect(sent[1][1].type).toStrictEqual('buffers')
  })

  it('should send values one at a time in an encoding that holds no list', async () => {
    request.properties.contentType = 'text/plain'

    const pipe = await ReplyPipe.create(request, Readable.from(['a', 'b']), channel, feedback, reply)

    await closing(pipe)

    expect(messages()).toStrictEqual([control.ok, 'a', 'b', control.end])
  })

  it('should keep a batch within its limit', async () => {
    const values = Array.from({ length: 300 }, (_, i) => i)
    const source = Readable.from(values, { highWaterMark: 1000 })
    const pipe = await ReplyPipe.create(request, source, channel, feedback, reply)

    await closing(pipe)

    const batches = messages().slice(1, -1)

    expect(batches.flat()).toStrictEqual(values)
    expect(Math.max(...batches.map((batch) => [batch].flat().length))).toBeLessThanOrEqual(128)
  })
})
