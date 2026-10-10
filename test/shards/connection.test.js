'use strict'

const { generate } = require('randomstring')
const { Promex } = require('../../source/promex')
const { random, immediate } = require('../helpers')

const mock = require('../connection.mock')

jest.mock('../../source/shards/channel')

const { Connection } = require('../../source/shards')
const { create } = require('../../source/shards/channel')

it('should be', async () => {
  expect(Connection).toBeDefined()
})

/** @type {jest.MockedObject<comq.Connection>[]} the connections made, in the order they were */
let connections

/** @type {jest.MockedFunction<(url: string, servername?: string) => comq.Connection>} */
let make

/** @type {comq.Connection} */
let connection

/** @type {jest.MockedObject<comq.Channel>[]} */
let channels

const urls = ['amqp://10.0.0.1', 'amqp://10.0.0.2']

const sharded = () => {
  const channel = {
    has: jest.fn(() => false),
    join: jest.fn(async () => undefined),
    retire: jest.fn(() => undefined),
    restore: jest.fn(() => undefined),
    quiet: jest.fn(async () => 0),
    leave: jest.fn(async () => undefined)
  }

  channels.push(channel)

  return channel
}

beforeEach(() => {
  jest.clearAllMocks()

  connections = []
  channels = []

  make = jest.fn(() => {
    const connection = mock.connection()

    connections.push(connection)

    return connection
  })

  create.mockImplementation(async () => sharded())

  connection = new Connection(urls, make)
})

describe('open', () => {
  it('should make a connection to each of the urls', async () => {
    await connection.open()

    expect(make).toHaveBeenCalledTimes(2)
    urls.forEach((url) => expect(make).toHaveBeenCalledWith(url, undefined))
    connections.forEach((conn) => expect(conn.open).toHaveBeenCalled())
  })

  it('should resolve when all of the connections are established', async () => {
    expect.assertions(2)

    /** @type {Promex[]} */
    const promises = []

    make.mockImplementation(() => {
      const conn = mock.connection()
      const promise = new Promex()

      conn.open.mockImplementation(() => promise)
      promises.push(promise)
      connections.push(conn)

      return conn
    })

    let resolved = false

    setImmediate(async () => {
      expect(resolved).toStrictEqual(false)

      const first = promises.shift()

      first.resolve()

      await immediate()

      promises.forEach((promise) => promise.resolve())

      resolved = true
    })

    await connection.open()

    expect(resolved).toStrictEqual(true)
  })

  it('should close opened connection if one fails', async () => {
    const exception = new Error(generate())

    connection = new Connection([...urls, 'amqp://10.0.0.3'], make)

    make.mockImplementation(() => {
      const conn = mock.connection()

      if (connections.length === 1) {
        conn.open.mockImplementation(async () => {
          await immediate()
          throw exception
        })
      }

      connections.push(conn)

      return conn
    })

    await expect(connection.open()).rejects.toThrow(exception)

    const [one, , two] = connections

    expect(one.close).toHaveBeenCalled()
    expect(two.close).toHaveBeenCalled()
  })
})

describe('close', () => {
  it('should close all connections', async () => {
    await connection.open()
    await connection.close()

    for (const conn of connections) {
      expect(conn.close).toHaveBeenCalled()
    }
  })
})

describe('createChannel', () => {
  const type = generate()

  beforeEach(async () => {
    await connection.open()
    await connection.createChannel(type)
  })

  it('should create channel over the connections, by the number of each', async () => {
    expect(create).toHaveBeenCalledWith(new Map(connections.entries()), type)
  })
})

describe.each(/** @type {comq.diagnostics.Event[]} */ ['open', 'close'])('diagnose %s event',
  (event) => {
    beforeEach(() => connection.open())

    it('should re-emit event', async () => {
      const index = random(connections.length)

      for (const conn of connections) {
        expect(conn.diagnose).toHaveBeenCalledWith(event, expect.any(Function))
      }

      const listener = /** @type {Function} */ jest.fn()

      connection.diagnose(event, listener)

      const call = connections[index].diagnose.mock.calls.find(
        (call) => call[0] === event)

      const emit = call[1]
      const args = [generate(), generate()]

      emit(event, ...args)

      expect(listener).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledWith(event, ...args, index)
    })
  })

describe('forget', () => {
  it('should stop re-emitting to the listener', async () => {
    await connection.open()

    const listener = /** @type {Function} */ jest.fn()

    connection.diagnose('open', listener)
    connection.forget('open', listener)

    const call = connections[0].diagnose.mock.calls.find((call) => call[0] === 'open')

    call[1]()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('names', () => {
  const INTERVAL = 1000
  const SETTLE = 3000
  const LINGER = 5000

  const names = ['amqp://one', 'amqp://two', 'amqp://three', 'amqp://four']

  /** @type {Record<string, string>} */
  let addresses

  /** @type {Record<string, jest.MockedFunction<Function>>} */
  let heard

  const tick = (ms = INTERVAL) => jest.advanceTimersByTimeAsync(ms)

  /**
   * @param {jest.MockedObject<comq.Connection>} conn
   * @param {comq.diagnostics.Event} event
   * @param {...any} args
   */
  const tell = (conn, event, ...args) => {
    for (const [name, listener] of conn.diagnose.mock.calls) if (name === event) listener(...args)
  }

  beforeEach(async () => {
    jest.useFakeTimers()

    addresses = { one: '10.0.0.1', two: '10.0.0.1', three: '10.0.0.2', four: '10.0.0.2' }

    global.COMQ_TESTING_LOOKUP = async (host) => ({ addresses: [addresses[host]], ttl: 1 })

    connection = new Connection(names, make, { interval: INTERVAL, settle: SETTLE, linger: LINGER })
    heard = { join: jest.fn(), retire: jest.fn(), leave: jest.fn() }

    for (const [event, listener] of Object.entries(heard)) connection.diagnose(event, listener)

    await connection.open()
    await connection.createChannel(generate())
  })

  afterEach(async () => {
    await connection.close()

    jest.useRealTimers()

    delete global.COMQ_TESTING_LOOKUP
  })

  it('should make a connection to each broker rather than to each name', async () => {
    expect(make).toHaveBeenCalledTimes(2)
    expect(make).toHaveBeenCalledWith('amqp://10.0.0.1', 'one')
    expect(make).toHaveBeenCalledWith('amqp://10.0.0.2', 'three')
  })

  it('should join a broker a name has moved to, once that has settled', async () => {
    addresses.four = '10.0.0.3'

    await tick(SETTLE)

    expect(make).toHaveBeenCalledTimes(2)

    await tick()

    expect(make).toHaveBeenCalledWith('amqp://10.0.0.3', 'four')
    expect(connections[2].open).toHaveBeenCalled()
    expect(channels[0].join).toHaveBeenCalledWith(connections[2], 2)
    expect(heard.join).toHaveBeenCalledWith(2, '10.0.0.3')
  })

  it('should not retire a broker that is still named', async () => {
    addresses.four = '10.0.0.3'

    await tick(SETTLE + LINGER * 2)

    expect(channels[0].retire).not.toHaveBeenCalled()
    expect(heard.retire).not.toHaveBeenCalled()
  })

  it('should retire a broker no name points at', async () => {
    addresses.three = '10.0.0.3'
    addresses.four = '10.0.0.3'

    await tick(SETTLE + INTERVAL)

    expect(channels[0].retire).toHaveBeenCalledWith(1)
    expect(heard.retire).toHaveBeenCalledWith(1, '10.0.0.2')
    expect(connections[1].close).not.toHaveBeenCalled()
  })

  it('should not retire a broker before the one named instead has joined', async () => {
    const opening = new Promex()

    make.mockImplementation(() => {
      const conn = mock.connection()

      conn.open.mockImplementation(() => opening)
      connections.push(conn)

      return conn
    })

    addresses.three = '10.0.0.3'
    addresses.four = '10.0.0.3'

    await tick(SETTLE + LINGER * 2)

    expect(heard.retire).not.toHaveBeenCalled()

    opening.resolve()

    await tick(0)

    expect(heard.retire).toHaveBeenCalledWith(1, '10.0.0.2')
  })

  it('should take a shard that has joined into a channel made later', async () => {
    addresses.four = '10.0.0.3'

    await tick(SETTLE + INTERVAL)
    await connection.createChannel(generate())

    expect(create).toHaveBeenLastCalledWith(new Map(connections.entries()), expect.any(String))
  })

  describe('retired', () => {
    beforeEach(async () => {
      addresses.three = '10.0.0.3'
      addresses.four = '10.0.0.3'

      await tick(SETTLE + INTERVAL)
    })

    it('should leave a broker that has been idle for the linger time', async () => {
      await tick(LINGER - INTERVAL)

      expect(heard.leave).not.toHaveBeenCalled()

      await tick(INTERVAL * 2)

      expect(channels[0].leave).toHaveBeenCalledWith(1)
      expect(connections[1].close).toHaveBeenCalled()
      expect(heard.leave).toHaveBeenCalledWith(1, '10.0.0.2')
    })

    it('should not leave a broker that has something to do', async () => {
      channels[0].quiet.mockImplementation(async () => Date.now())

      await tick(LINGER * 3)

      expect(heard.leave).not.toHaveBeenCalled()
      expect(connections[1].close).not.toHaveBeenCalled()

      channels[0].quiet.mockImplementation(async () => 0)

      await tick()

      expect(heard.leave).toHaveBeenCalledWith(1, '10.0.0.2')
    })

    it('should count the linger time from when the broker was last busy', async () => {
      const busy = Date.now() + INTERVAL * 2

      channels[0].quiet.mockImplementation(async () => busy)

      await tick(LINGER + INTERVAL)

      expect(heard.leave).not.toHaveBeenCalled()

      await tick(INTERVAL * 2)

      expect(heard.leave).toHaveBeenCalled()
    })

    it('should give up on a broker that is out of reach for the linger time', async () => {
      connections[1].connected = false
      channels[0].quiet.mockImplementation(async () => Date.now())

      await tick(LINGER + INTERVAL * 2)

      expect(heard.leave).toHaveBeenCalledWith(1, '10.0.0.2')
    })

    it('should put a broker that is named again back', async () => {
      addresses.four = '10.0.0.2'

      await tick(SETTLE + INTERVAL)

      expect(channels[0].restore).toHaveBeenCalledWith(1)
      expect(heard.join).toHaveBeenCalledWith(1, '10.0.0.2')

      await tick(LINGER * 2)

      expect(heard.leave).not.toHaveBeenCalled()
    })

    it('should retire in a channel made later', async () => {
      const channel = await connection.createChannel(generate())

      expect(channel.retire).toHaveBeenCalledWith(1)
    })

    it('should join anew a broker that was left', async () => {
      await tick(LINGER + INTERVAL)

      addresses.four = '10.0.0.2'

      await tick(SETTLE + INTERVAL)

      expect(make).toHaveBeenCalledTimes(4)
      expect(heard.join).toHaveBeenCalledWith(3, '10.0.0.2')
    })
  })

  it('should follow at once the names of a broker that is out of reach', async () => {
    addresses.three = '10.0.0.3'
    addresses.four = '10.0.0.3'

    connections[1].connected = false

    tell(connections[1], 'close', new Error('lost'))

    await tick(0)

    expect(make).toHaveBeenCalledWith('amqp://10.0.0.3', 'three')
    expect(heard.join).toHaveBeenCalledWith(2, '10.0.0.3')
  })

  it('should report a name that fails to resolve', async () => {
    const listener = jest.fn()
    const exception = new Error('ENOTFOUND')

    connection.diagnose('error', listener)

    global.COMQ_TESTING_LOOKUP = async () => { throw exception }

    await tick()

    expect(listener).toHaveBeenCalledWith(exception)
    expect(heard.retire).not.toHaveBeenCalled()
  })

  it('should not take a broker that cannot be consumed from for one that has joined', async () => {
    const exception = new Error('PRECONDITION_FAILED')
    const listener = jest.fn()

    connection.diagnose('error', listener)
    channels[0].join.mockImplementationOnce(async () => { throw exception })

    addresses.three = '10.0.0.3'
    addresses.four = '10.0.0.3'

    await tick(SETTLE + INTERVAL)

    expect(listener).toHaveBeenCalledWith(exception, 2)
    expect(heard.join).not.toHaveBeenCalled()
    expect(heard.retire).not.toHaveBeenCalled()
    expect(channels[0].leave).toHaveBeenCalledWith(2)
    expect(connections[2].close).toHaveBeenCalled()

    // and joins it anew later
    await tick()

    expect(heard.join).toHaveBeenCalledWith(3, '10.0.0.3')
    expect(heard.retire).toHaveBeenCalledWith(1, '10.0.0.2')
  })

  it('should ask again a broker that refused', async () => {
    const exception = new Error('ACCESS-REFUSED')
    const listener = jest.fn()

    connection.diagnose('error', listener)

    make.mockImplementationOnce(() => {
      const conn = mock.connection()

      conn.open.mockImplementation(async () => { throw exception })
      connections.push(conn)

      return conn
    })

    addresses.four = '10.0.0.3'

    await tick(SETTLE + INTERVAL)

    expect(listener).toHaveBeenCalledWith(exception, 2)
    expect(heard.join).not.toHaveBeenCalled()

    await tick()

    expect(heard.join).toHaveBeenCalledWith(3, '10.0.0.3')
  })
})
