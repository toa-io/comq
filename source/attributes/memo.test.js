'use strict'

const { memo } = require('./memo')

let fn
let memoized

beforeEach(() => {
  jest.clearAllMocks()

  fn = jest.fn(() => Math.random())
  memoized = memo(fn)
})

it('should return value', async () => {
  const value = memoized()

  expect(value).toBe(fn.mock.results[0].value)
})

it('should pass arguments', async () => {
  const args = [1, 2, 3]

  memoized(...args)

  expect(fn).toHaveBeenCalledWith(...args)
})

it('should memoize value', async () => {
  const one = memoized()
  const two = memoized()

  expect(fn).toHaveBeenCalledTimes(1)
  expect(one).toBe(fn.mock.results[0].value)
  expect(two).toBe(fn.mock.results[0].value)
})
