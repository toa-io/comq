'use strict'

const { generate } = require('randomstring')

const { mock } = require('./singleton.fixtures')

jest.mock('../source/connection', () => ({ Connection: mock.Connection }))

const { SingletonConnection } = require('../source/singleton')

it('should be', async () => {
  expect(SingletonConnection).toBeInstanceOf(Function)
})

/** @type {SingletonConnection} */
let connection

const url = generate()

beforeEach(() => {
  jest.clearAllMocks()

  SingletonConnection.__lets_pretend_this_method_doesnt_exist()

  connection = new SingletonConnection(url)
})

it('should extend Connection', async () => {
  expect(connection).toBeInstanceOf(mock.Connection)
  expect(mock.Connection.ctor).toHaveBeenCalledWith(url)
})

describe('connection', () => {
  beforeEach(async () => {
    await connection.open()
  })

  afterEach(async () => {
    await connection.close()
  })

  it('should open connection', async () => {
    expect(mock.Connection.open).toHaveBeenCalled()
  })

  it('should open connection once per url across instances', async () => {
    jest.clearAllMocks()

    const url = generate()
    const second = new SingletonConnection(url)
    const third = new SingletonConnection(url)

    await Promise.all([second.open(), third.open()])

    expect(mock.Connection.open).toHaveBeenCalledTimes(1)

    const fourth = new SingletonConnection(generate())

    await fourth.open()

    expect(mock.Connection.open).toHaveBeenCalledTimes(2)

    await second.close()
    await third.close()
    await fourth.close()
  })

  it('should close connection', async () => {
    await connection.close()

    expect(mock.Connection.close).toHaveBeenCalled()
  })

  it('should close connection once', async () => {
    const url = generate()
    const one = new SingletonConnection(url)
    const two = new SingletonConnection(url)

    await Promise.all([one.open(), two.open()])
    await Promise.all([one.close(), two.close()])

    expect(mock.Connection.close).toHaveBeenCalledTimes(1)
  })

  it('should not close connection if other instances connected', async () => {
    jest.clearAllMocks()
    const second = new SingletonConnection(url)

    await second.open()
    await second.close()

    expect(mock.Connection.close).not.toHaveBeenCalled()
  })

  it('should close connection when all instances are disconnected', async () => {
    const second = new SingletonConnection(url)

    await second.open()
    await second.close()
    await connection.close()

    expect(mock.Connection.close).toHaveBeenCalled()
  })

  it('should reopen connection', async () => {
    const one = new SingletonConnection(url)

    await connection.close()
    await one.open()

    expect(mock.Connection.open).toHaveBeenCalledTimes(2)
  })
})
