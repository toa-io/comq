'use strict'

const { generate } = require('randomstring')
const { timeout } = require('@toa.io/generic')

const { lazy } = require('./lazy')

it('should be', async () => {
  expect(lazy).toBeDefined()
})

// noinspection JSValidateTypes
/** @type {jest.MockedFn<(...args: any[]) => Promise<void>>} */
const action = jest.fn(async () => undefined)

// noinspection JSValidateTypes
/** @type {jest.MockedFn<(...args: any[]) => Promise<void>>} */
const initialize = jest.fn(async () => undefined)

const value = generate()

class LazyInitialized {
  log = []

  action = lazy(this, this.#initialize, this.#action)

  async #initialize () {
    await timeout(1)
    await initialize()
    this.log.push('initializer')
  }

  async #action (...args) {
    await action(...args)
    this.log.push('action')

    return value
  }
}

let instance

beforeEach(() => {
  jest.clearAllMocks()

  instance = new LazyInitialized()
})

it('should call initializer before action', async () => {
  await instance.action()

  expect(instance.log).toStrictEqual(['initializer', 'action'])
})

it('should pass arguments to action', async () => {
  const args = [generate(), generate()]

  await instance.action(...args)

  expect(action).toHaveBeenCalledWith(...args)
})

it('should return value', async () => {
  const output = await instance.action()

  expect(output).toStrictEqual(value)
})

it('should call initializer once', async () => {
  await instance.action()
  await instance.action()

  expect(initialize).toHaveBeenCalledTimes(1)
  expect(instance.log).toStrictEqual(['initializer', 'action', 'action'])
})

it('should call initializer once on concurrent calls', async () => {
  await Promise.all([instance.action(), instance.action()])

  expect(initialize).toHaveBeenCalledTimes(1)
  expect(instance.log).toStrictEqual(['initializer', 'action', 'action'])
})

it('should call initializer once per instance', async () => {
  const instance2 = new LazyInitialized()

  await instance.action()
  await instance2.action()

  expect(initialize).toHaveBeenCalledTimes(2)
})

// noinspection JSValidateTypes
/** @type {jest.MockedFn<(...args: any[]) => Promise<void>>} */
const initialize2 = jest.fn(async () => undefined)

class InitializerSet {
  action = lazy(this, [this.#initialize1, this.#initialize2], this.#action)

  async #action () {

  }

  async #initialize1 () {
    await initialize()
  }

  async #initialize2 () {
    await initialize2()
  }
}

it('should run list of initializers', async () => {
  const instance = new InitializerSet()

  await instance.action()

  expect(initialize).toHaveBeenCalled()
  expect(initialize2).toHaveBeenCalled()
})

class InitializerIntersection {
  do = lazy(this, [this.#initialize1, this.#initialize2], this.#do)

  undo = lazy(this, this.#initialize2, this.#undo)

  async #do () {

  }

  async #undo () {

  }

  async #initialize1 () {
    await initialize()
  }

  async #initialize2 () {
    await initialize2()
  }
}

it('should call intersecting initializers once', async () => {
  jest.clearAllMocks()

  const instance = new InitializerIntersection()

  await instance.do()
  await instance.undo()

  expect(initialize).toHaveBeenCalledTimes(1)
  expect(initialize2).toHaveBeenCalledTimes(1)
})

it('should call intersecting concurrent initializers once', async () => {
  jest.clearAllMocks()

  const instance = new InitializerIntersection()

  await Promise.all([instance.do(), instance.undo()])

  expect(initialize).toHaveBeenCalledTimes(1)
  expect(initialize2).toHaveBeenCalledTimes(1)
})

class InitializersWithArguments {
  do = lazy(this, [this.#initialize1, this.#initialize2], this.#do)

  async #do (a, b, c) {}

  async #initialize1 () {
    await initialize(arguments)
  }

  async #initialize2 (a, b) {
    await initialize2(arguments)
  }
}

it('should pass arguments to initializers if expected', async () => {
  jest.clearAllMocks()

  const instance = new InitializersWithArguments()

  await instance.do(1, 2, 3)

  expect(initialize).toHaveBeenCalledTimes(1)

  const args = initialize.mock.calls[0][0]

  expect(args.length).toStrictEqual(0)

  expect(initialize2).toHaveBeenCalledTimes(1)

  const args2 = initialize2.mock.calls[0][0]

  expect(args2.length).toStrictEqual(2)
})

it('should call conditions with different argument values', async () => {
  jest.clearAllMocks()

  const instance = new InitializersWithArguments()

  await instance.do(1, 2, 3)
  await instance.do(1, 2)
  await instance.do(2, 2)

  expect(initialize).toHaveBeenCalledTimes(1)
  expect(initialize2).toHaveBeenCalledTimes(2)
})

class OrderedInitializers {
  log = []

  do = lazy(this, [this.#initialize1, this.#initialize2], async () => undefined)

  async #initialize1 () {
    await timeout(1)
    this.log.push(1)
  }

  async #initialize2 (a, b) {
    this.log.push(2)
  }
}

it('should call initializers sequentially', async () => {
  const instance = new OrderedInitializers()

  await instance.do()

  expect(instance.log).toStrictEqual([1, 2])
})

it('should override argument values', async () => {
  const method = /** @type {Function} */ jest.fn()

  class Test {
    do = lazy(this, this.#update, method)

    #update (foo, bar) {
      return [foo + ' updated', bar + ' updated']
    }
  }

  const test = new Test()
  const foo = generate()
  const bar = generate()

  await test.do(foo, bar)

  expect(method).toHaveBeenCalledWith(foo + ' updated', bar + ' updated')
})

it('should partially override argument values', async () => {
  const method = /** @type {Function} */ jest.fn()

  class Test {
    do = lazy(this, this.#update, method)

    #update (foo, bar) {
      return [foo + ' updated']
    }
  }

  const test = new Test()
  const foo = generate()
  const bar = generate()

  await test.do(foo, bar)

  expect(method).toHaveBeenCalledWith(foo + ' updated', bar)
})

describe('reset', () => {
  it('should be', async () => {
    expect(lazy.reset).toBeDefined()
  })

  it('should reset initialization', async () => {
    const instance = new InitializerIntersection()

    await instance.do()
    await instance.undo()

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize2).toHaveBeenCalledTimes(1)

    lazy.reset(instance)

    await instance.do()
    await instance.undo()

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(initialize2).toHaveBeenCalledTimes(2)
  })
})
