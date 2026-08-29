'use strict'

const { generate } = require('randomstring')
const emitter = require('../source/emitter')

/** @type {import('node:events').EventEmitter} */
let instance

beforeEach(() => {
  instance = emitter.create()
})

it('should be', async () => {
  expect(emitter.create).toBeInstanceOf(Function)
})

it('should emit', async () => {
  const listener = jest.fn()
  const event = generate()
  const args = [generate(), generate()]

  instance.on(event, listener)

  expect(instance.emit(event, ...args)).toStrictEqual(true)
  expect(listener).toHaveBeenCalledWith(...args)
})

it('should report an event no one listens to', async () => {
  expect(instance.emit(generate())).toStrictEqual(false)
})

it('should not throw on error without listeners', async () => {
  expect(() => instance.emit('error', new Error(generate()))).not.toThrow()
})

it('should not let a listener break the emission', async () => {
  const event = generate()
  const listener = jest.fn()

  instance.on(event, () => { throw new Error(generate()) })
  instance.on(event, listener)

  expect(() => instance.emit(event)).not.toThrow()

  // the listeners that follow a broken one are still called
  expect(listener).toHaveBeenCalled()
})

it('should call a `once` listener once', async () => {
  const event = generate()
  const listener = jest.fn()

  instance.once(event, listener)

  instance.emit(event)
  instance.emit(event)

  expect(listener).toHaveBeenCalledTimes(1)
})

it('should not call a listener that has been removed', async () => {
  const event = generate()
  const listener = jest.fn()

  instance.on(event, listener)
  instance.off(event, listener)

  instance.emit(event)

  expect(listener).not.toHaveBeenCalled()
})
