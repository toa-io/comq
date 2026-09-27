'use strict'

// Jest's globals, on top of node:test.
//
// The runner is Node's own; the assertions, the mocks and the fake timers are still Jest's,
// taken as the standalone packages they are published as. Loaded with `--import`, so that
// the test files themselves keep seeing `it`, `expect` and `jest` as globals.

const { createRequire } = require('node:module')
const { format } = require('node:util')
const nodeTest = require('node:test')
const { expect } = require('expect')
const { ModuleMocker } = require('jest-mock')
const { ModernFakeTimers } = require('@jest/fake-timers')

// node:test drives its own queue with process.nextTick: faking it, as Jest does inside its
// sandbox, stops the runner mid-file and the tests left behind are never reported as missing
const DO_NOT_FAKE = ['nextTick']

const mocker = new ModuleMocker(globalThis)
const timers = new ModernFakeTimers({ global: globalThis, config: { rootDir: process.cwd() } })

/**
 * Where `jest.mock` was called from, so that its specifier resolves
 * relative to the test file rather than to this one.
 *
 * @returns {string}
 */
function origin () {
  const prepare = Error.prepareStackTrace

  Error.prepareStackTrace = (_, frames) => frames

  const { stack } = new Error('origin')

  Error.prepareStackTrace = prepare

  for (const frame of stack) {
    const file = frame.getFileName()

    if (file !== null && file !== undefined && file !== __filename && !file.startsWith('node:')) {
      return file
    }
  }

  throw new Error('cannot tell which file has called jest.mock')
}

/**
 * Replaces a module, as `jest.mock` does. Without a factory the module is automocked:
 * every function it exports becomes a mock function.
 *
 * @param {string} specifier
 * @param {() => object} [factory]
 */
function mockModule (specifier, factory) {
  if (nodeTest.mock.module === undefined) {
    throw new Error('jest.mock requires node --experimental-test-module-mocks')
  }

  const path = createRequire(origin()).resolve(specifier)

  const namedExports = factory === undefined
    ? mocker.generateFromMetadata(mocker.getMetadata(require(path)))
    : factory()

  nodeTest.mock.module(path, { namedExports, cache: false })
}

const jest = {
  fn: (implementation) => mocker.fn(implementation),
  spyOn: (object, property, accessType) => mocker.spyOn(object, property, accessType),
  clearAllMocks: () => mocker.clearAllMocks(),
  resetAllMocks: () => mocker.resetAllMocks(),
  restoreAllMocks: () => mocker.restoreAllMocks(),
  mock: mockModule,
  useFakeTimers: (config) => timers.useFakeTimers({ doNotFake: DO_NOT_FAKE, ...config }),
  useRealTimers: () => timers.useRealTimers(),
  advanceTimersByTime: (ms) => timers.advanceTimersByTime(ms),
  advanceTimersByTimeAsync: (ms) => timers.advanceTimersByTimeAsync(ms),
  runAllTimers: () => timers.runAllTimers(),
  runAllTimersAsync: () => timers.runAllTimersAsync(),
  runOnlyPendingTimers: () => timers.runOnlyPendingTimers(),
  getTimerCount: () => timers.getTimerCount(),
  setSystemTime: (now) => timers.setSystemTime(now)
}

/**
 * `it.each` / `describe.each`: one test per row, the row spread into the callback,
 * the title formatted with the row's values.
 *
 * @param {Function} declare
 * @returns {(table: any[]) => (title: string, fn: Function, options?: object) => void}
 */
const each = (declare) => (table) => (title, fn, options) => {
  const placeholders = (title.replace(/%%/g, '').match(/%[sdifjoOc]/g) ?? []).length

  for (const row of table) {
    const values = Array.isArray(row) ? row : [row]

    declare(format(title, ...values.slice(0, placeholders)), options, () => fn(...values))
  }
}

/**
 * Jest's `it` and `describe` carry `.each`; node:test's do not.
 *
 * @param {Function} declare
 * @returns {Function}
 */
function extend (declare) {
  // Jest takes a timeout where node:test takes options
  const call = (...args) => declare(...(typeof args[2] === 'number'
    ? [args[0], { timeout: args[2] }, args[1]]
    : args))

  const extended = Object.assign(call, declare, { each: each(call) })

  extended.only = Object.assign((...args) => declare.only(...args), { each: each(declare.only) })
  extended.skip = Object.assign((...args) => declare.skip(...args), { each: each(declare.skip) })
  extended.todo = (...args) => declare.todo(...args)

  return extended
}

Object.assign(globalThis, {
  jest,
  expect,
  it: extend(nodeTest.it),
  test: extend(nodeTest.test),
  describe: extend(nodeTest.describe),
  beforeEach: nodeTest.beforeEach,
  afterEach: nodeTest.afterEach,
  beforeAll: nodeTest.before,
  afterAll: nodeTest.after
})

// `expect.assertions` is only enforced by whoever runs the test
nodeTest.afterEach(() => {
  const errors = expect.extractExpectedAssertionsErrors()

  if (errors.length > 0) throw errors[0].error
})
