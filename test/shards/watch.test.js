'use strict'

const { Watch } = require('../../source/shards/watch')

/** @type {Record<string, comq.shards.Resolution | Error>} */
let records

/** @type {Watch} */
let watch

/** @type {jest.MockedFunction<Function>} */
let change

/** @type {jest.MockedFunction<Function>} */
let error

const INTERVAL = 1000
const SETTLE = 5000
const hosts = ['one', 'two']

const tick = (ms = INTERVAL) => jest.advanceTimersByTimeAsync(ms)

/**
 * @param {comq.shards.Timing} [timing]
 * @param {(host: string) => boolean} [urgent]
 */
async function start (timing = { interval: INTERVAL, settle: SETTLE }, urgent) {
  watch = new Watch(hosts, timing, urgent)
  change = jest.fn()
  error = jest.fn()

  watch.on('change', change)
  watch.on('error', error)

  return await watch.start()
}

beforeEach(() => {
  jest.useFakeTimers()

  records = { one: { addresses: ['10.0.0.1'], ttl: 5 }, two: { addresses: ['10.0.0.2'], ttl: 5 } }

  global.COMQ_TESTING_LOOKUP = async (host) => {
    if (records[host] instanceof Error) throw records[host]

    return records[host]
  }
})

afterEach(() => {
  watch?.stop()
  jest.useRealTimers()

  delete global.COMQ_TESTING_LOOKUP
})

it('should tell the address of each name', async () => {
  const addresses = await start()

  expect(Object.fromEntries(addresses)).toStrictEqual({ one: '10.0.0.1', two: '10.0.0.2' })
})

it('should not tell of what has not changed', async () => {
  await start()
  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
})

it('should tell of a change once it has held for the settle time', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(SETTLE)

  expect(change).not.toHaveBeenCalled()

  await tick()

  expect(change).toHaveBeenCalledTimes(1)
  expect(Object.fromEntries(change.mock.calls[0][0])).toStrictEqual({ one: '10.0.0.1', two: '10.0.0.3' })
})

it('should start the settle time anew whenever the answer changes', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(SETTLE - INTERVAL)

  records.one = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(SETTLE - INTERVAL)

  expect(change).not.toHaveBeenCalled()

  await tick(INTERVAL * 2)

  expect(change).toHaveBeenCalledTimes(1)
  expect(Object.fromEntries(change.mock.calls[0][0])).toStrictEqual({ one: '10.0.0.3', two: '10.0.0.3' })
})

it('should not act on an answer that goes back and forth', async () => {
  await start()

  for (let i = 0; i < 20; i++) {
    records.two = { addresses: [i % 2 === 0 ? '10.0.0.3' : '10.0.0.2'], ttl: 5 }

    await tick()
  }

  expect(change).not.toHaveBeenCalled()
})

it('should forget a change that was taken back', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(INTERVAL * 2)

  records.two = { addresses: ['10.0.0.2'], ttl: 5 }

  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
})

it('should keep the address of a name that fails to resolve', async () => {
  await start()

  const exception = new Error('ENOTFOUND')

  records.two = exception

  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith(exception)
})

it('should keep the address of a name that resolves to nothing', async () => {
  await start()

  records.two = { addresses: [] }

  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalled()
})

it('should keep the address in use while it is listed', async () => {
  await start()

  records.two = { addresses: ['10.0.0.1', '10.0.0.2'], ttl: 5 }

  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
})

it('should take what an urgent name resolves to at once', async () => {
  await start(undefined, (host) => host === 'two')

  records.one = { addresses: ['10.0.0.4'], ttl: 5 }
  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick()

  expect(change).toHaveBeenCalledTimes(1)
  expect(Object.fromEntries(change.mock.calls[0][0])).toStrictEqual({ one: '10.0.0.1', two: '10.0.0.3' })
})

it('should look at once when poked', async () => {
  await start(undefined, () => true)

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  watch.poke()

  await tick(0)

  expect(change).toHaveBeenCalledTimes(1)
})

it('should resolve until every name is known', async () => {
  global.COMQ_TESTING_RESOLVE_BACKOFF = { base: 10, dispersion: 0 }

  records.two = new Error('ENOTFOUND')

  let addresses

  const starting = start().then((result) => { addresses = result })

  await tick(100)

  expect(addresses).toBeUndefined()

  records.two = { addresses: ['10.0.0.2'], ttl: 5 }

  await tick(100)
  await starting

  expect(addresses.get('two')).toStrictEqual('10.0.0.2')

  delete global.COMQ_TESTING_RESOLVE_BACKOFF
})

it('should stop', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }
  watch.stop()

  await tick(SETTLE * 2)

  expect(change).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toStrictEqual(0)
})

describe('timing', () => {
  it('should settle and linger for the longest TTL seen', async () => {
    records.one = { addresses: ['10.0.0.1'], ttl: 300 }
    records.two = { addresses: ['10.0.0.2'], ttl: 120 }

    await start({})

    records.one = { addresses: ['10.0.0.1'], ttl: 10 }

    await tick(10_000)

    expect(watch.settle).toStrictEqual(300_000)
    expect(watch.linger).toStrictEqual(300_000)
  })

  it('should settle for no less than 30 seconds', async () => {
    await start({})

    expect(watch.settle).toStrictEqual(30_000)
    expect(watch.linger).toStrictEqual(30_000)
  })

  it('should give a name answered without a TTL 60 seconds', async () => {
    records.two = { addresses: ['10.0.0.2'] }

    await start({})

    expect(watch.settle).toStrictEqual(60_000)
  })

  it('should resolve every 10 seconds unless told otherwise', async () => {
    await start({})

    expect(watch.interval).toStrictEqual(10_000)
  })

  it('should take what it is told', async () => {
    await start({ interval: 1, settle: 2, linger: 3 })

    expect([watch.interval, watch.settle, watch.linger]).toStrictEqual([1, 2, 3])
  })
})
