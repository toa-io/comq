'use strict'

const { retry } = require('./retry')

const immediate = { base: 0, max: 0, dispersion: 0 }

it('should return the result', async () => {
  const result = await retry(async () => 'ok', immediate)

  expect(result).toStrictEqual('ok')
})

it('should retry while the operation asks for it', async () => {
  let attempts = 0

  const result = await retry(async (again) => {
    attempts++

    return attempts < 3 ? again : 'ok'
  }, immediate)

  expect(attempts).toStrictEqual(3)
  expect(result).toStrictEqual('ok')
})

it('should pass the same token on every attempt', async () => {
  const tokens = []

  await retry(async (again) => {
    tokens.push(again)

    return tokens.length < 3 ? again : 'ok'
  }, immediate)

  expect(tokens).toHaveLength(3)
  expect(new Set(tokens).size).toStrictEqual(1)
})

it('should throw what the operation throws', async () => {
  const exception = new Error('nope')

  await expect(retry(async () => { throw exception }, immediate)).rejects.toThrow(exception)
})

it('should give up after the last attempt', async () => {
  let attempts = 0

  const attempt = retry(async (again) => {
    attempts++

    return again
  }, { ...immediate, attempts: 3 })

  await expect(attempt).rejects.toThrow('Maximum attempts exceeded')
  expect(attempts).toStrictEqual(3)
})

it('should not run the operation without an attempt to spare', async () => {
  const operation = jest.fn(async (again) => again)

  await expect(retry(operation, { ...immediate, attempts: 0 }))
    .rejects.toThrow('Maximum attempts exceeded')

  expect(operation).not.toHaveBeenCalled()
})

it('should back off, up to the maximum, before each attempt', async () => {
  jest.useFakeTimers()

  try {
    const waits = []

    let last = Date.now()
    let attempts = 0

    const attempt = retry(async (again) => {
      waits.push(Date.now() - last)
      last = Date.now()
      attempts++

      return attempts < 5 ? again : 'ok'
    }, { base: 100, factor: 2, max: 300, dispersion: 0 })

    await jest.advanceTimersByTimeAsync(10_000)

    expect(await attempt).toStrictEqual('ok')

    // the first attempt waits for nothing; then 100, 200, and 400 capped at 300
    expect(waits).toStrictEqual([0, 100, 200, 300, 300])
  } finally {
    jest.useRealTimers()
  }
})

it('should spread the wait around the interval', async () => {
  const waits = []

  const timer = global.setTimeout

  global.setTimeout = (callback, ms) => {
    waits.push(ms)

    return timer(callback, 0)
  }

  try {
    let attempts = 0

    await retry(async (again) => {
      attempts++

      return attempts < 20 ? again : 'ok'
    }, { base: 1000, factor: 1, max: 1000, dispersion: 0.1 })
  } finally {
    global.setTimeout = timer
  }

  expect(waits.every((ms) => ms >= 950 && ms <= 1050)).toStrictEqual(true)
  expect(new Set(waits).size).toBeGreaterThan(1)
})
