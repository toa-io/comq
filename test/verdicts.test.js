'use strict'

const { generate } = require('randomstring')
const { Retry, Park, verdictOf, RETRY, PARK, VERDICT } = require('../source/verdicts')

it('should be', async () => {
  expect(Retry).toBeDefined()
  expect(Park).toBeDefined()
})

describe('verdictOf', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['a plain Error', new Error(generate())],
    ['an object branded with something else', { [Symbol.for('other.verdict')]: 'park' }],
    ['an object whose brand is not a verdict', { [VERDICT]: generate() }]
  ])('should read %s as a retry', async (_, exception) => {
    expect(verdictOf(exception)).toStrictEqual(RETRY)
  })

  it('should read Retry as a retry', async () => {
    expect(verdictOf(new Retry(generate()))).toStrictEqual(RETRY)
  })

  it('should read Park as a park', async () => {
    expect(verdictOf(new Park(generate()))).toStrictEqual(PARK)
  })

  it('should read a Park thrown by another copy of comq', async () => {
    // a dependency pinning comq while the application resolves its own tree makes two
    // copies the ordinary outcome, and `instanceof` is silently false across them
    const foreign = { [Symbol.for('comq.verdict')]: 'park' }

    expect(verdictOf(foreign)).toStrictEqual(PARK)
    expect(foreign instanceof Park).toStrictEqual(false)
  })
})

describe('the classes', () => {
  it.each([['Retry', Retry], ['Park', Park]])('should make %s an Error', async (name, Verdict) => {
    const message = generate()
    const verdict = new Verdict(message)

    expect(verdict).toBeInstanceOf(Error)
    expect(verdict.message).toStrictEqual(message)
    expect(verdict.name).toStrictEqual(name)
    expect(typeof verdict.stack).toStrictEqual('string')
  })

  it.each([['Retry', Retry], ['Park', Park]])('should let %s carry a cause', async (_, Verdict) => {
    const cause = new Error(generate())

    expect(new Verdict(generate(), { cause }).cause).toStrictEqual(cause)
  })
})
