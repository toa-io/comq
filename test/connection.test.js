'use strict'

// region setup

const { generate } = require('randomstring')

const { Promex } = require('promex')
const { timeout, random } = require('./helpers')
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

    expect(amqplib.connect).toHaveBeenCalledWith(expect.stringContaining(url),
      expect.objectContaining({ timeout: expect.any(Number) }))
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

  it('should keep an error sink on a dropped connection', async () => {
    const channel = await connection.createChannel('request')

    channel.recover
      .mockRejectedValueOnce(new Error('Channel closed'))
      .mockResolvedValue(undefined)

    conn.emit('close', new Error('lost'))

    await timeout(10)

    const dropped = await amqplib.connect.mock.results[1].value

    // amqplib goes on emitting on a connection it does not know is gone, and an
    // 'error' with no listener left takes the process down
    expect(() => dropped.emit('error', new Error('Heartbeat timeout'))).not.toThrow()

    // let the attempt that follows the failed recovery settle
    const start = Date.now()

    while (channel.recover.mock.calls.length < 2 && Date.now() - start < 10000) await timeout(50)
  }, 15000)

  it('should reconnect despite a listener that throws', async () => {
    // a diagnostic listener has no business breaking the reconnection it reports
    connection.diagnose('reconnect', () => { throw new Error('listener') })
    connection.diagnose('open', () => { throw new Error('listener') })

    conn.emit('close', new Error('lost'))

    await expect(connection.createChannel('event')).resolves.toBeDefined()

    expect(amqplib.connect).toHaveBeenCalledTimes(2)
  }, 10000)

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

  it('should emit reconnect when restoring a lost connection', async () => {
    const reconnect = jest.fn()

    connection.diagnose('reconnect', reconnect)
    conn.emit('close', new Error('lost'))

    await connection.createChannel('event')

    expect(reconnect).toHaveBeenCalled()
  }, 10000)

  it('should bound a connect that never settles', async () => {
    jest.useFakeTimers()

    try {
      const errors = []

      connection.diagnose('error', (exception) => errors.push(exception))
      amqplib.connect.mockImplementation(() => new Promise(() => undefined))

      conn.emit('close', new Error('lost'))

      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(30_000)

      expect(errors).toEqual([expect.objectContaining({ code: 'ETIMEDOUT' })])

      await jest.advanceTimersByTimeAsync(2_000)

      expect(amqplib.connect.mock.calls.length).toBeGreaterThan(2)
    } finally {
      jest.useRealTimers()
    }
  })

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

    const promise = new Promex()

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

describe('channel exhaustion', () => {
  const EXHAUSTED = 'No channels left to allocate'

  /** @type {jest.MockedObject<comq.amqp.Connection>} */
  let conn

  beforeEach(async () => {
    await connection.open()

    conn = await amqplib.connect.mock.results[0].value
  })

  it('should reject rather than wait for a recovery that is not coming', async () => {
    create.mockImplementation(async () => { throw new Error(EXHAUSTED) })

    // the regression is a hang, so the assertion is that it settles at all
    const settled = await Promise.race([
      connection.createChannel('event').then(() => 'resolved', (e) => e.message),
      timeout(100).then(() => 'pending')
    ])

    expect(settled).toStrictEqual(EXHAUSTED)
  })

  it('should not retry', async () => {
    create.mockImplementation(async () => { throw new Error(EXHAUSTED) })

    await connection.createChannel('event').catch(() => undefined)

    expect(create).toHaveBeenCalledTimes(1)
  })

  it('should report the limit the broker negotiated', async () => {
    const listener = jest.fn()

    await connection.diagnose('exhausted', listener)

    create.mockImplementation(async () => { throw new Error(EXHAUSTED) })

    await connection.createChannel('event').catch(() => undefined)

    expect(listener).toHaveBeenCalledWith(conn.connection.channelMax)
  })

  it('should leave every other failure its recovery', async () => {
    create.mockImplementation(async () => { throw new Error() })

    setTimeout(() => {
      create.mockImplementation(async () => generate())

      conn.emit('close', new Error())
    }, 1)

    const channel = await connection.createChannel('request')

    expect(channel).toStrictEqual(await create.mock.results[1].value)
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

    await jest.advanceTimersByTimeAsync(46_000)

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should reconnect after the watchdog destroys a silent connection', async () => {
    jest.useFakeTimers()

    await connection.open()

    await jest.advanceTimersByTimeAsync(46_000)

    // a socket destroyed without an error is a socket amqplib never reports,
    // which leaves the connection silently dead instead of recovering
    expect(amqplib.connect).toHaveBeenCalledTimes(2)
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

    await jest.advanceTimersByTimeAsync(40_000)

    conn.connection.stream.emit('data', Buffer.alloc(0))

    await jest.advanceTimersByTimeAsync(40_000)

    expect(conn.connection.stream.destroy).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(10_000)

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should derive the watchdog from the negotiated heartbeat', async () => {
    jest.useFakeTimers()

    const connection = new Connection('amqp://localhost?heartbeat=30')

    await connection.open()

    const conn = await amqplib.connect.mock.results[0].value

    // the broker is only expected to say something every 15 seconds
    await jest.advanceTimersByTimeAsync(60_000)

    expect(conn.connection.stream.destroy).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(31_000)

    expect(conn.connection.stream.destroy).toHaveBeenCalled()
  })

  it('should not arm the watchdog when heartbeats are disabled', async () => {
    jest.useFakeTimers()

    const connection = new Connection('amqp://localhost?heartbeat=0')

    await connection.open()

    const conn = await amqplib.connect.mock.results[0].value

    // an idle connection that has agreed to no heartbeats is silent by design
    await jest.advanceTimersByTimeAsync(600_000)

    expect(conn.connection.stream.destroy).not.toHaveBeenCalled()
  })
})

describe('heartbeat', () => {
  it('should ask for a heartbeat', async () => {
    const connection = new Connection('amqp://developer@localhost')

    await connection.open()

    expect(amqplib.connect).toHaveBeenCalledWith('amqp://developer@localhost?heartbeat=15',
      expect.anything())
  })

  it('should append the heartbeat to an existing query', async () => {
    const connection = new Connection('amqp://localhost?frameMax=8192')

    await connection.open()

    expect(amqplib.connect).toHaveBeenCalledWith('amqp://localhost?frameMax=8192&heartbeat=15',
      expect.anything())
  })

  it.each(['amqp://localhost?heartbeat=5', 'amqp://localhost?heartbeat=0'])(
    'should keep the heartbeat requested by the caller (%s)',
    async (url) => {
      const connection = new Connection(url)

      await connection.open()

      expect(amqplib.connect).toHaveBeenCalledWith(url, expect.anything())
    })

  it('should keep the socket alive', async () => {
    await connection.open()

    expect(amqplib.connect)
      .toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ keepAlive: true }))
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

  it('should not emit reconnect on the initial open', async () => {
    const reconnect = jest.fn()

    connection.diagnose('reconnect', reconnect)

    jest.clearAllMocks()

    connection = new Connection(url)
    connection.diagnose('reconnect', reconnect)

    await connection.open()

    expect(reconnect).not.toHaveBeenCalled()
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
