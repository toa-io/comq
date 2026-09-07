'use strict'

// Watches what a closed IO leaves behind. Every scenario keeps weak references to
// what it has opened and closed, and expects the garbage collector to have taken
// all of it; the heap growth per iteration is reported alongside.

const v8 = require('node:v8')
const vm = require('node:vm')
const stream = require('node:stream')
const { generate } = require('randomstring')
const { timeout } = require('./helpers')
const mock = require('./amqplib.mock')
const { amqplib, connect } = mock

jest.mock('amqplib', () => mock.amqplib)

const { connect: open, assert } = require('../source')
const { SingletonConnection } = require('../source/singleton')

v8.setFlagsFromString('--expose-gc')

const gc = vm.runInNewContext('gc')

/** @type {{ scenario: string, iterations: number, watched: number, retained: number, growth: string }[]} */
const report = []

beforeEach(() => {
  jest.clearAllMocks()
  amqplib.connect.mockImplementation(async (url) => wired(await connect(url)))

  global.COMQ_TESTING_SHUTDOWN_TIMEOUT = 1
  global.COMQ_TESTING_WATCHDOG_INTERVAL = 60_000
})

afterEach(() => {
  SingletonConnection.__lets_pretend_this_method_doesnt_exist()

  delete global.COMQ_TESTING_SHUTDOWN_TIMEOUT
  delete global.COMQ_TESTING_WATCHDOG_INTERVAL
})

afterAll(() => {
  console.info('Memory report (heap growth is per iteration, after garbage collection)\n' +
    formatted(report))
})

it('should let go of an IO and its channels once closed', async () => {
  const retained = await measure('connect, reply, consume, emit, close', 100, async () => {
    const io = await open(generate())

    await io.reply(generate(), () => generate())
    await io.consume(generate(), generate(), () => undefined)
    await io.emit(generate(), { value: generate() })
    await io.enqueue(generate(), { value: generate() })

    const channels = await amqpChannels()

    await io.close()

    return [io, ...channels]
  })

  expect(retained).toStrictEqual(0)
})

// a singleton connection outlives every IO opened on it
it('should let go of the IOs of a singleton connection', async () => {
  const url = generate()

  const retained = await measure('assert, reply, close (singleton)', 100, async () => {
    const io = await assert(url)

    await io.reply(generate(), () => generate())

    const channels = await amqpChannels()

    await io.close()

    return [io, ...channels]
  })

  expect(retained).toStrictEqual(0)
})

it('should let go of the streams passed to request and emit', async () => {
  const io = await open(generate())
  const queue = generate()
  const exchange = generate()

  await io.reply(queue, (request) => request)

  const retained = await measure('request and emit with a stream', 100, async () => {
    const requests = stream.Readable.from([{ a: generate() }, { b: generate() }])
    const events = stream.Readable.from([{ a: generate() }, { b: generate() }])

    const replies = await io.request(queue, requests)

    // eslint-disable-next-line no-void, no-unused-vars
    for await (const _ of replies) void 0

    await io.emit(exchange, events)

    return [requests, events]
  })

  await io.close()

  expect(retained).toStrictEqual(0)
})

it('should let go of the channels lost with a connection', async () => {
  const io = await open(generate())

  await io.reply(generate(), () => generate())
  await io.consume(generate(), generate(), () => undefined)

  const retained = await measure('reconnection', 50, async () => {
    const before = await amqpChannels()
    const conn = await amqplib.connect.mock.results.at(-1).value

    let recovered = 0

    const recovery = new Promise((resolve) => io.diagnose('recover', () => { if (++recovered === 3) resolve() }))

    conn.emit('close', new Error(generate()))

    await recovery

    return before
  })

  await io.close()

  expect(retained).toStrictEqual(0)
})

/**
 * @param {string} scenario
 * @param {number} iterations
 * @param {(index: number) => Promise<object[]>} iteration returning what must be collected afterwards
 * @return {Promise<number>} how many of the watched objects are still alive
 */
async function measure (scenario, iterations, iteration) {
  /** @type {WeakRef<object>[]} */
  const refs = []

  await collect()

  const before = process.memoryUsage().heapUsed

  // in a frame of its own, so that nothing of the last iteration is left on the stack
  await watch(refs, iterations, iteration)

  // mocks remember what they returned, and spies are registered until restored,
  // either of which would keep what they were made on alive
  jest.clearAllMocks()
  jest.restoreAllMocks()

  await collect()

  const after = process.memoryUsage().heapUsed
  const retained = refs.filter((ref) => ref.deref() !== undefined).length
  const growth = ((after - before) / iterations / 1024).toFixed(1) + ' KB'

  report.push({ scenario, iterations, watched: refs.length, retained, growth })

  return retained
}

/**
 * @param {WeakRef<object>[]} refs
 * @param {number} iterations
 * @param {(index: number) => Promise<object[]>} iteration
 */
async function watch (refs, iterations, iteration) {
  for (let i = 0; i < iterations; i++) {
    const objects = await iteration(i)

    for (const object of objects) refs.push(new WeakRef(object))
  }
}

/**
 * The channels amqplib has been asked for since the last call.
 *
 * @return {Promise<object[]>}
 */
async function amqpChannels () {
  const channels = []

  for (const { value } of amqplib.connect.mock.results) {
    const conn = await value

    for (const method of ['createChannel', 'createConfirmChannel']) {
      for (const result of conn[method].mock.results) channels.push(await result.value)

      conn[method].mockClear()
    }
  }

  return channels
}

/**
 * A broker of sorts: what is published to a queue is delivered to its consumer,
 * so that requests are answered and streams of them come to an end.
 *
 * @param {jest.MockedObject<comq.amqp.Connection>} conn
 * @return {jest.MockedObject<comq.amqp.Connection>}
 */
function wired (conn) {
  const consumers = new Map()
  const tags = new Map()

  // a broker forgets the consumers of a connection that is gone
  conn.on('close', () => consumers.clear())

  for (const method of ['createChannel', 'createConfirmChannel']) {
    const create = conn[method].getMockImplementation()

    conn[method].mockImplementation(async () => {
      const chan = await create()

      chan.consume.mockImplementation(async (queue, callback) => {
        const consumerTag = generate()

        consumers.set(queue, callback)
        tags.set(consumerTag, queue)

        return { consumerTag }
      })

      chan.cancel.mockImplementation(async (consumerTag) => {
        consumers.delete(tags.get(consumerTag))
        tags.delete(consumerTag)
      })

      chan.publish.mockImplementation((exchange, routingKey, content, properties, resolve) => {
        resolve?.(null)

        const callback = consumers.get(routingKey)

        if (callback !== undefined) setImmediate(callback, { content, properties, fields: { exchange, routingKey } })

        return true
      })

      return chan
    })
  }

  return conn
}

async function collect () {
  // an object a WeakRef was made for in the current task is kept until the task ends
  await timeout(0)

  gc()
  gc()

  await timeout(0)

  gc()
}

function formatted (rows) {
  const columns = ['scenario', 'iterations', 'watched', 'retained', 'growth']
  const width = (column) => Math.max(column.length, ...rows.map((row) => String(row[column]).length))
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(width(columns[i]))).join('  ')

  return [line(columns), ...rows.map((row) => line(columns.map((column) => row[column])))].join('\n')
}
