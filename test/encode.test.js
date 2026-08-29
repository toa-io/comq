'use strict'

const { generate } = require('randomstring')

const { encode } = require('../source/encode')

it('should be', async () => {
  expect(encode).toBeDefined()
})

it('should throw if encoding is not supported', async () => {
  const value = 1
  const encoding = /** @type {comq.Encoding} */ 'wtf/' + generate()

  expect(() => encode(value, encoding)).toThrow('not supported')
})

it('should encode as json', async () => {
  const value = { [generate()]: generate() }
  const buffer = encode(value, 'application/json')

  const json = JSON.stringify(value)
  const expected = Buffer.from(json)

  expect(buffer).toStrictEqual(expected)
})

/** @type {[comq.Encoding, string, Buffer][]} */
const samples = [
  ['text/plain', 'some string', Buffer.from('some string')]
]

it.each(samples)('should encode %', async (encoding, input, output) => {
  const buffer = encode(input, encoding)

  expect(buffer).toStrictEqual(output)
})
