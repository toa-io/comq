'use strict'

const { Writable } = require('node:stream')

const { batch } = require('../source/batch')

/** A socket, as far as writing to it goes: what it was given, and how many times. */
function socket () {
  const writes = []

  return Object.assign(new Writable({
    write (chunk, _encoding, callback) {
      writes.push([chunk.toString()])
      callback()
    },
    writev (chunks, callback) {
      writes.push(chunks.map(({ chunk }) => chunk.toString()))
      callback()
    }
  }), { writes })
}

const tick = () => new Promise((resolve) => process.nextTick(resolve))

it('should be', async () => {
  expect(batch).toBeDefined()
})

it('should write what a turn wrote as one', async () => {
  const stream = socket()

  batch(stream)

  stream.write('a')
  stream.write('b')

  await tick()

  expect(stream.writes).toStrictEqual([['a', 'b']])
})

it('should write what a later turn wrote on its own', async () => {
  const stream = socket()

  batch(stream)

  stream.write('a')

  await tick()

  stream.write('b')

  await tick()

  expect(stream.writes).toStrictEqual([['a'], ['b']])
})

it('should not hold a write past its turn', async () => {
  const stream = socket()

  batch(stream)

  stream.write('a')

  await tick()

  expect(stream.writes).toStrictEqual([['a']])
})

it('should take a socket once', async () => {
  const stream = socket()

  batch(stream)

  const wrapped = stream.write

  batch(stream)

  expect(stream.write).toStrictEqual(wrapped)
})

it('should leave alone what does not cork', async () => {
  for (const value of [undefined, null, {}, { write: () => undefined }]) {
    expect(() => batch(value)).not.toThrow()
  }

  const written = []
  const plain = { write: (chunk) => written.push(chunk) }

  batch(plain)
  plain.write('a')

  expect(written).toStrictEqual(['a'])
})
