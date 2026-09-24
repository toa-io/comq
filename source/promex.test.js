'use strict'

const { Promex } = require('./promex')

it('should resolve', async () => {
  const promise = new Promex()

  setImmediate(() => promise.resolve('ok'))

  await expect(promise).resolves.toStrictEqual('ok')
})

it('should reject', async () => {
  const promise = new Promex()

  setImmediate(() => promise.reject(new Error('oh')))

  await expect(promise).rejects.toThrow('oh')
})

it('should resolve using the callback', async () => {
  const promise = new Promex()

  setImmediate(() => promise.callback(null, 'ok'))

  await expect(promise).resolves.toStrictEqual('ok')
})

it('should reject using the callback', async () => {
  const promise = new Promex()

  setImmediate(() => promise.callback('oh'))

  await expect(promise).rejects.toStrictEqual('oh')
})

it('should resolve using the callback given no error', async () => {
  const promise = new Promex()

  setImmediate(() => promise.callback(undefined, 'ok'))

  await expect(promise).resolves.toStrictEqual('ok')
})

it('should run the executor it is given', async () => {
  const promise = new Promex((resolve) => resolve('ok'))

  await expect(promise).resolves.toStrictEqual('ok')
})

it('should stay settled by whoever holds it', async () => {
  const promise = new Promex()

  promise.resolve('first')
  promise.resolve('second')

  await expect(promise).resolves.toStrictEqual('first')
})

it('should be a promise', async () => {
  const promise = new Promex()

  expect(promise).toBeInstanceOf(Promise)

  promise.resolve('ok')

  await expect(Promise.all([promise])).resolves.toStrictEqual(['ok'])
})

it('should derive promises of its own kind', async () => {
  const promise = new Promex()
  const derived = promise.then((value) => value + '!')

  expect(derived).toBeInstanceOf(Promex)

  promise.resolve('ok')

  await expect(derived).resolves.toStrictEqual('ok!')
})
