'use strict'

const { generate } = require('randomstring')
const { failsafe } = require('./failsafe')

it('should be', async () => {
  expect(failsafe).toBeDefined()
})

beforeEach(() => {
  jest.clearAllMocks()
})

const fn = /** @type {jest.MockedFunction} */
  jest.fn(async () => generate())
const recover = /** @type {jest.MockedFunction<(...args: any[]) => Promise<any>>} */
  jest.fn(async () => true)

class FailsafeTest {
  doWithRecovery = failsafe(this, this.#recover, async (...args) => {
    return fn(...args)
  })

  doWithoutRecovery = failsafe(this, (...args) => {
    return fn(...args)
  })

  async #recover (exception) {
    return recover(exception)
  }
}

/** @type {FailsafeTest} */
let instance

beforeEach(() => {
  jest.clearAllMocks()

  instance = new FailsafeTest()
})

describe.each([
  ['with', 'doWithRecovery'],
  ['without', 'doWithoutRecovery']
])('%s recovery', (_, method) => {
  it('should run fn', async () => {
    await instance[method]()

    expect(fn).toHaveBeenCalled()
  })

  it('should return value', async () => {
    const value = await instance[method]()

    expect(value).toStrictEqual(await fn.mock.results[0].value)
  })

  it('should pass arguments', async () => {
    const args = [generate(), generate()]

    await instance[method](...args)

    expect(fn).toHaveBeenCalledWith(...args)
  })

  it('should call again', async () => {
    fn.mockImplementationOnce(async () => { throw new Error() })

    await instance[method]()

    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('recovery function', () => {
  it('should recover on exception', async () => {
    fn.mockImplementationOnce(async () => { throw new Error() })

    const value = await instance.doWithRecovery()

    expect(value).toStrictEqual(await fn.mock.results[1].value)
  })

  it('should throw on recovery failure', async () => {
    const exception = generate()

    fn.mockImplementationOnce(async () => { throw exception })
    recover.mockImplementationOnce(async () => false)

    await expect(instance.doWithRecovery()).rejects.toStrictEqual(exception)
  })

  it('should pass exception to recover', async () => {
    const exception = generate()

    fn.mockImplementationOnce(async () => { throw exception })

    await instance.doWithRecovery()

    expect(recover).toHaveBeenCalledWith(exception)
  })

  it('should call recover within context', async () => {
    class Test {
      foo = 1

      do = failsafe(this, this.recover, fn)

      recover () {
        expect(this.foo).toStrictEqual(1)
      }
    }

    const instance = new Test()

    fn.mockImplementationOnce(() => { throw new Error() })

    instance.do()
  })
})

describe('disable', () => {
  it('should throw exception', async () => {
    const exception = generate()

    failsafe.disable(instance.doWithRecovery, instance.doWithoutRecovery)

    fn.mockImplementation(async () => { throw exception })

    await expect(instance.doWithRecovery()).rejects.toStrictEqual(exception)
    await expect(instance.doWithoutRecovery()).rejects.toStrictEqual(exception)
  })
})
