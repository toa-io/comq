'use strict'

// region setup

const { generate } = require('randomstring')

const { timeout, promex, random } = require('@toa.io/generic')
const { amqplib, connect } = require('./amqplib.mock')
const { channel: create } = require('./connection.mock')
const mock = { amqplib, channel: { create } }

jest.mock('amqplib', () => mock.amqplib)
jest.mock('../source/channel', () => mock.channel)

const presets = require('../source/topology')
const { Connection } = require('../source/connection')

it('should be', async () => {
  expect(Connection).toBeDefined()
})

/** @type {comq.Connection} */
let connection

const url = generate()

beforeEach(() => {
  jest.clearAllMocks()
  amqplib.connect.mockImplementation(connect)

  connection = new Connection(url)
})

// endregion

describe('initial connection', () => {
  it('should connect', async () => {
    await connection.open()

    expect(amqplib.connect).toHaveBeenCalledWith(url, { timeout: expect.any(Number) })
  })

  it.each(/** @type {[string, Partial<Error>][]} */[
    ['Socket closed', { message: 'Socket closed abruptly during opening handshake' }],
    ['TLS disconnect', { message: 'Client network socket disconnected before secure TLS connection was established' }],
    ['connect timeout', { message: 'connect ETIMEDOUT' }],
    ['ECONNREFUSED', { code: 'ECONNREFUSED' }],
    ['EAI_AGAIN', { code: 'EAI_AGAIN' }],
    ['ENOTFOUND', { code: 'ENOTFOUND' }],
    ['ETIMEDOUT', { code: 'ETIMEDOUT' }],
    ['ECONNRESET', { code: 'ECONNRESET' }],
    ['EHOSTUNREACH', { code: 'EHOSTUNREACH' }],
    ['ENETUNREACH', { code: 'ENETUNREACH' }]
  ])('should reconnect on %s',
    async (_, error) => {
      amqplib.connect.mockImplementationOnce(async () => { throw error })

      await expect(connection.open()).resolves.not.toThrow()

      expect(amqplib.connect).toHaveBeenCalledTimes(2)
    })

  it('should throw if error is permanent', async () => {
    const exception = new Error(generate())

    amqplib.connect.mockImplementationOnce(async () => { throw exception })

    await expect(connection.open()).rejects.toStrictEqual(exception)
  })
})

describe('reconnection', () => {
  /** @type {jest.MockedObject<comq.amqp.Connection>} */
  let conn

  beforeEach(async () => {
    await connection.open()

    conn = await amqplib.connect.mock.results[0].value
  })

  it('should reconnect on error', async () => {
    expect(amqplib.connect).toHaveBeenCalledTimes(1)

    // const clear = jest.spyOn(conn, 'removeAllListeners')
    const error = { code: 'ECONNREFUSED' }

    conn.emit('close', error)

    expect(conn.removeAllListeners).toHaveBeenCalled()
    expect(amqplib.connect).toHaveBeenCalledTimes(2)
  })

  it('should not reconnect without error', async () => {
    conn.emit('close')

    expect(amqplib.connect).toHaveBeenCalledTimes(1)
  })

  it('should prevent process crash', async () => {
    expect(conn.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('should recover channels', async () => {
    const channel = await connection.createChannel('request')

    //    const channel = await create.mock.results[0].value

    expect(channel).toBeDefined()

    conn.emit('close', new Error())

    await timeout(0)

    expect(amqplib.connect).toHaveBeenCalledTimes(2)

    const replacement = await amqplib.connect.mock.results[1].value

    expect(channel.recover).toHaveBeenCalledWith(replacement)
  })

  it('should retry when channel recover fails', async () => {
    const channel = await connection.createChannel('request')

    channel.recover
      .mockRejectedValueOnce(new Error('Channel closed'))
      .mockResolvedValue(undefined)

    conn.emit('close', new Error())

    const start = Date.now()

    while (channel.recover.mock.calls.length < 2 && Date.now() - start < 10000) {
      await timeout(50)
    }

    expect(channel.recover).toHaveBeenCalledTimes(2)
    expect(amqplib.connect.mock.calls.length).toBeGreaterThanOrEqual(3)
  }, 15000)

  it('should emit error when reconnect open fails', async () => {
    const errors = []
    const unhandled = jest.fn()

    connection.diagnose('error', (exception) => errors.push(exception))
    process.on('unhandledRejection', unhandled)

    const boom = new Error('reconnect failed')

    connection.open = jest.fn(async () => { throw boom })

    conn.emit('close', new Error('broker down'))

    await timeout(10)

    process.off('unhandledRejection', unhandled)

    expect(errors).toContain(boom)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('should reconnect when connection is lost while channels recover', async () => {
    const channel = await connection.createChannel('request')

    // the connection is lost right after the topology has been recovered on it
    channel.recover.mockImplementationOnce(async (connection) => {
      connection.emit('close', new Error('lost again'))
    })

    conn.emit('close', new Error('lost'))

    await expect(connection.createChannel('event')).resolves.toBeDefined()

    expect(amqplib.connect).toHaveBeenCalledTimes(3)
  }, 10000)

  it('should not wait for a connection that failed to recover to close', async () => {
    const channel = await connection.createChannel('request')

    channel.recover
      .mockRejectedValueOnce(new Error('Channel closed'))
      .mockResolvedValue(undefined)

    // Close-Ok never arrives on a connection that has already been lost
    conn.close.mockImplementation(() => new Promise(() => undefined))
    conn.emit('close', new Error('lost'))

    await timeout(0)

    const failed = await amqplib.connect.mock.results[1].value

    failed.close.mockImplementation(() => new Promise(() => undefined))

    await expect(connection.createChannel('event')).resolves.toBeDefined()

    expect(failed.connection.stream.destroy).toHaveBeenCalled()
  }, 10000)

  it('should emit error on a failed connection attempt', async () => {
    const errors = []
    const exception = { code: 'ECONNREFUSED' }

    connection.diagnose('error', (error) => errors.push(error))
    amqplib.connect.mockImplementationOnce(async () => { throw exception })

    conn.emit('close', new Error('lost'))

    // the attempt is retried, hence the channel is created on the next connection
    await connection.createChannel('event')

    expect(errors).toContain(exception)
  }, 10000)

  it('should ignore close from a stale connection', async () => {
    const stale = conn
    const closeHandler = stale.on.mock.calls.find(([event]) => event === 'close')[1]

    stale.emit('close', new Error('gone'))

    await timeout(50)

    const live = await amqplib.connect.mock.results[1].value
    const connects = amqplib.connect.mock.calls.length

    expect(live).not.toBe(stale)

    live.removeAllListeners.mockClear()
    closeHandler(new Error('late'))

    await timeout(10)

    expect(amqplib.connect).toHaveBeenCalledTimes(connects)
    expect(live.removeAllListeners).not.toHaveBeenCalled()
  })
})

describe('create channel', () => {
  /** @type {jest.MockedObject<comq.amqp.Connection>} */
  let conn

  beforeEach(async () => {
    await connection.open()

    conn = await amqplib.connect.mock.results[0].value
  })

  it.each(
    /** @type {comq.topology.type[]} */
    ['request', 'reply', 'event'])('should create failsafe channel of %s type',
    async (type) => {
      // noinspection JSCheckFunctionSignatures
      create.mockImplementationOnce(async () => generate())

      const preset = presets[type]
      const channel = await connection.createChannel(type)

      expect(create).toHaveBeenCalledWith(conn, preset, undefined)
      expect(channel).toStrictEqual(await create.mock.results[0].value)
    })

  it('should create failfast channel', async () => {
    const type = 'request'
    const index = random()

    await connection.createChannel(type, index)

    expect(create).toHaveBeenCalledWith(expect.anything(), expect.anything(), index)
  })

  it('should create channel after exception', async () => {
    create.mockImplementation(async () => { throw new Error() })

    setTimeout(() => {
      // noinspection JSCheckFunctionSignatures
      create.mockImplementation(async () => generate())

      conn.emit('close', new Error())
    }, 1)

    const channel = await connection.createChannel('request')

    expect(channel).toStrictEqual(await create.mock.results[1].value)
  })

  it('should wait for initial connection', async () => {
    jest.clearAllMocks()
    expect.assertions(2)

    connection = new Connection(url)

    setImmediate(async () => {
      expect(create).not.toHaveBeenCalled()

      await connection.open()
    })

    await connection.createChannel('request')

    expect(create).toHaveBeenCalled()
  })

  it('should wait for reconnection', async () => {
    expect.assertions(3)

    jest.clearAllMocks()

    const promise = promex()

    amqplib.connect.mockImplementationOnce(() => promise)

    conn.emit('close', new Error())

    expect(amqplib.connect).toHaveBeenCalled()

    setImmediate(async () => {
      expect(create).not.toHaveBeenCalled()

      const conn = await amqplib.connect()

      promise.resolve(conn)
    })

    await connection.createChannel('request')

    expect(create).toHaveBeenCalled()
  })
})

describe('watchdog', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('should destroy silent connection when watchdog expires', async () => {
    jest.useFakeTimers()

    await connection.open()

    const conn = await amqplib.connect.mock.results[0].value

    await jest.advanceTimersByTimeAsync(60_000)

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should not let a replaced socket disarm the watchdog', async () => {
    jest.useFakeTimers()

    await connection.open()

    const stale = await amqplib.connect.mock.results[0].value

    stale.emit('close', new Error('lost'))

    await jest.advanceTimersByTimeAsync(1)

    const live = await amqplib.connect.mock.results[1].value

    await jest.advanceTimersByTimeAsync(30_000)

    stale.connection.stream.emit('data', Buffer.alloc(0))

    await jest.advanceTimersByTimeAsync(30_000)

    expect(live.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should reset watchdog on socket data', async () => {
    jest.useFakeTimers()

    await connection.open()

    const conn = await amqplib.connect.mock.results[0].value

    await jest.advanceTimersByTimeAsync(50_000)

    conn.connection.stream.emit('data', Buffer.alloc(0))

    await jest.advanceTimersByTimeAsync(50_000)

    expect(conn.connection.stream.destroy).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(10_000)

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })
})

describe('close', () => {
  beforeEach(() => {
    global.COMQ_TESTING_SHUTDOWN_TIMEOUT = 10
  })

  afterEach(() => {
    delete global.COMQ_TESTING_SHUTDOWN_TIMEOUT
  })

  it('should close connection', async () => {
    await connection.open()
    await connection.close()

    const amqp = await amqplib.connect.mock.results[0].value

    expect(amqp.close).toHaveBeenCalled()
    expect(connection.closed).toStrictEqual(true)
  })

  it('should close after connection is (re)established', async () => {
    // don't wait for completion
    connection.open().then()

    await connection.close()

    /** @type {jest.MockedObject<comq.amqp.Connection>} */
    const conn = await amqplib.connect.mock.results[0].value

    expect(conn.close).toHaveBeenCalled()
  })

  it('should not wait for Close-Ok that never arrives', async () => {
    await connection.open()

    /** @type {jest.MockedObject<comq.amqp.Connection>} */
    const conn = await amqplib.connect.mock.results[0].value

    conn.close.mockImplementation(() => new Promise(() => undefined))

    await connection.close()

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should open again after close', async () => {
    await connection.open()
    await connection.close()
    await connection.open()

    await expect(connection.createChannel('request')).resolves.toBeDefined()

    expect(amqplib.connect).toHaveBeenCalledTimes(2)
  })

  it('should stop reconnecting', async () => {
    await connection.open()

    const conn = await amqplib.connect.mock.results[0].value
    const attempts = []

    connection.diagnose('error', (exception) => attempts.push(exception))
    amqplib.connect.mockImplementation(async () => { throw { code: 'ECONNREFUSED' } }) // eslint-disable-line

    conn.emit('close', new Error('lost'))

    await connection.close()

    const failed = attempts.length

    await timeout(1500)

    expect(attempts.length).toStrictEqual(failed)
  }, 10000)
})

describe('diagnostics', () => {
  beforeEach(async () => {
    await connection.open()
  })

  it('should emit `open` event', async () => {
    let captured = false

    connection.diagnose('open', () => (captured = true))

    await connection.open()

    expect(captured).toStrictEqual(true)
  })

  it('should re-emit `close` event', async () => {
    let captured

    connection.diagnose('close', (error) => (captured = error))

    const amqp = await amqplib.connect.mock.results[0].value
    const error = generate()

    amqp.emit('close', error)

    expect(captured).toStrictEqual(error)
  })

  it('should handle max listeners', async () => {
    for (let i = 0; i < 100; i++) {
      connection.diagnose('close', () => undefined)
    }
  })
})
