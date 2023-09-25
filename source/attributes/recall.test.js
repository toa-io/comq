'use strict'

const { generate } = require('randomstring')
const { recall } = require('./recall')

it('should be', async () => {
  expect(recall).toBeDefined()
})

const context = { foo: generate() }

/** @type {jest.MockedFn<(...args: any[]) => any>} */
let method

beforeEach(() => {
  jest.clearAllMocks()

  method = /** @type {jest.MockedFn<(...args: any[]) => any>} */
    jest.fn(function () { return this.foo })
})

it('should return function', async () => {
  const func = recall(context, method)

  expect(func).toBeInstanceOf(Function)
})

it('should return result', async () => {
  const func = recall(context, method)
  const output = await func()

  expect(output).toStrictEqual(await method.mock.results[0].value)
})

it('should call method within the context', async () => {
  const func = recall(context, method)
  const output = await func()

  expect(output).toStrictEqual(context.foo)
})

it('should pass arguments', async () => {
  const args = [generate(), generate()]
  const func = recall(context, method)

  await func(...args)

  expect(method).toHaveBeenCalledWith(...args)
})

it('should re-call', async () => {
  const args1 = [generate(), generate()]
  const args2 = [generate(), generate(), generate()]
  const func = recall(context, method)

  await func(...args1)
  await func(...args2)

  method.mockClear()

  expect(method).not.toHaveBeenCalled()

  await recall(context)

  expect(method).toHaveBeenCalledWith(...args1)
  expect(method).toHaveBeenCalledWith(...args2)
})

it('should not trow on empty re-call', async () => {
  await expect(recall(context)).resolves.not.toThrow()
})

it('should not re-call those thrown exceptions', async () => {
  expect.assertions(2)

  method.mockImplementationOnce(async () => 1)
  method.mockImplementationOnce(async () => { throw new Error() })

  const func = recall(context, method)

  await func()

  try {
    await func()
  } catch (e) {
    expect(e).toBeDefined()
  }

  await recall(context)

  expect(method).toHaveBeenCalledTimes(3)
})
