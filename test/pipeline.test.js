'use strict'

const { EventEmitter } = require('node:events')
const stream = require('node:stream')
const { pipeline, transform } = require('../source/pipeline')
const { timeout } = require('@toa.io/generic')

/** @type {Channel} */
let channel

beforeEach(() => {
  channel = new Channel()
})

it('should pipeline', async () => {
  const input = stream.Readable.from([1, 2, 3])
  const pipe = pipeline(input, (x) => x * x, channel)
  const output = []

  for await (const x of pipe) {
    output.push(x)
  }

  expect(output).toStrictEqual([1, 4, 9])
})

it('should control source', async () => {
  async function * generate () {
    for (let i = 1; i < 4; i++) {
      await timeout(1)

      yield i
    }
  }

  const input = stream.Readable.from(generate())

  // eslint-disable-next-line no-void
  void pipeline(input, (x) => x * x, channel)

  channel.emit('pause')

  await timeout(0)

  expect(input.isPaused()).toBe(true)

  channel.emit('resume')

  await timeout(0)

  expect(input.isPaused()).toBe(false)
})

it('should wait for end', async () => {
  async function * generate () {
    for (let i = 1; i < 4; i++) {
      await timeout(1)

      yield i
    }
  }

  let finished = 0

  const fn = jest.fn(async () => {
    await timeout(1)
    finished++
  })
  const input = stream.Readable.from(generate())

  await transform(input, fn, channel)

  expect(fn).toHaveBeenCalledTimes(3)
  expect(finished).toBe(3)
})

class Channel extends EventEmitter {
  diagnose (event, callback) {
    this.on(event, callback)
  }
}
