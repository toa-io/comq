'use strict'

const { Name } = require('../../source/shards/name')

/** @type {Record<string, comq.shards.Resolution | Error>} */
let records

/** @type {Record<string, number>} how many times each name has been resolved */
let resolved

/** @type {Name} */
let name

/** @type {comq.shards.Follower & Record<string, jest.MockedFunction<any>>} */
let follower

/** @type {() => void} */
let leave

const INTERVAL = 1000
const SETTLE = 5000
const timing = { interval: INTERVAL, settle: SETTLE }

const tick = (ms = INTERVAL) => jest.advanceTimersByTimeAsync(ms)

/**
 * @param {boolean} [urgent]
 * @return {comq.shards.Follower & Record<string, jest.MockedFunction<any>>}
 */
const followerOf = (urgent = false) => ({ change: jest.fn(), error: jest.fn(), urgent: jest.fn(() => urgent) })

/**
 * @param {comq.shards.Timing} [options]
 * @param {boolean} [urgent]
 */
async function start (options = timing, urgent = false) {
  name = Name.of('two', options)
  follower = followerOf(urgent)
  leave = name.follow(follower)

  return await name.start()
}

beforeEach(() => {
  jest.useFakeTimers()

  records = { one: { addresses: ['10.0.0.1'], ttl: 5 }, two: { addresses: ['10.0.0.2'], ttl: 5 } }
  resolved = { one: 0, two: 0 }

  global.COMQ_TESTING_LOOKUP = async (host) => {
    resolved[host]++

    if (records[host] instanceof Error) throw records[host]

    return records[host]
  }
})

afterEach(() => {
  Name.__lets_pretend_this_method_doesnt_exist()
  jest.useRealTimers()

  delete global.COMQ_TESTING_LOOKUP
})

it('should tell the address of the name', async () => {
  const address = await start()

  expect(address).toStrictEqual('10.0.0.2')
})

it('should not tell of what has not changed', async () => {
  await start()
  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
})

it('should tell of a change once it has held for the settle time', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(SETTLE)

  expect(follower.change).not.toHaveBeenCalled()

  await tick()

  expect(follower.change).toHaveBeenCalledTimes(1)
  expect(follower.change).toHaveBeenCalledWith('two', '10.0.0.3')
})

it('should start the settle time anew whenever the answer changes', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(SETTLE - INTERVAL)

  records.two = { addresses: ['10.0.0.4'], ttl: 5 }

  await tick(SETTLE - INTERVAL)

  expect(follower.change).not.toHaveBeenCalled()

  await tick(INTERVAL * 2)

  expect(follower.change).toHaveBeenCalledTimes(1)
  expect(follower.change).toHaveBeenCalledWith('two', '10.0.0.4')
})

it('should not act on an answer that goes back and forth', async () => {
  await start()

  for (let i = 0; i < 20; i++) {
    records.two = { addresses: [i % 2 === 0 ? '10.0.0.3' : '10.0.0.2'], ttl: 5 }

    await tick()
  }

  expect(follower.change).not.toHaveBeenCalled()
})

it('should forget a change that was taken back', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick(INTERVAL * 2)

  records.two = { addresses: ['10.0.0.2'], ttl: 5 }

  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
})

it('should keep the address of a name that fails to resolve', async () => {
  await start()

  const exception = new Error('ENOTFOUND')

  records.two = exception

  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
  expect(follower.error).toHaveBeenCalledWith(exception)
})

it('should keep the address of a name that resolves to nothing', async () => {
  await start()

  records.two = { addresses: [] }

  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
  expect(follower.error).toHaveBeenCalled()
})

it('should keep the address in use while it is listed', async () => {
  await start()

  records.two = { addresses: ['10.0.0.1', '10.0.0.2'], ttl: 5 }

  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
})

it('should take what an urgent name resolves to at once', async () => {
  await start(timing, true)

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  await tick()

  expect(follower.change).toHaveBeenCalledWith('two', '10.0.0.3')
  expect(follower.urgent).toHaveBeenCalledWith('two')
})

it('should look at once when poked', async () => {
  await start(timing, true)

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }

  name.poke()

  await tick(0)

  expect(follower.change).toHaveBeenCalledTimes(1)
})

it('should resolve until the name is known', async () => {
  global.COMQ_TESTING_RESOLVE_BACKOFF = { base: 10, dispersion: 0 }

  records.two = new Error('ENOTFOUND')

  let address

  const starting = start().then((result) => { address = result })

  await tick(100)

  expect(address).toBeUndefined()

  records.two = { addresses: ['10.0.0.2'], ttl: 5 }

  await tick(100)
  await starting

  expect(address).toStrictEqual('10.0.0.2')

  delete global.COMQ_TESTING_RESOLVE_BACKOFF
})

it('should stop once nobody follows it', async () => {
  await start()

  records.two = { addresses: ['10.0.0.3'], ttl: 5 }
  leave()

  await tick(SETTLE * 2)

  expect(follower.change).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toStrictEqual(0)
  expect(Name.of('two', timing)).not.toBe(name)
})

describe('shared', () => {
  it('should be one for everyone with the same timing', async () => {
    expect(Name.of('two', timing)).toBe(Name.of('two', { ...timing }))
    expect(Name.of('two', timing)).not.toBe(Name.of('two', { interval: INTERVAL * 2 }))
    expect(Name.of('two', timing)).not.toBe(Name.of('one', timing))
  })

  it('should be resolved once however many follow it', async () => {
    await start()

    const others = Array.from({ length: 10 }, () => followerOf())

    for (const other of others) Name.of('two', timing).follow(other)

    await Promise.all(others.map(() => Name.of('two', timing).start()))

    expect(resolved.two).toStrictEqual(1)

    await tick(INTERVAL * 3)

    expect(resolved.two).toStrictEqual(4)
  })

  it('should tell everyone who follows it of a change', async () => {
    await start()

    const other = followerOf()

    Name.of('two', timing).follow(other)
    records.two = { addresses: ['10.0.0.3'], ttl: 5 }

    await tick(SETTLE + INTERVAL)

    expect(follower.change).toHaveBeenCalledWith('two', '10.0.0.3')
    expect(other.change).toHaveBeenCalledWith('two', '10.0.0.3')
  })

  it('should tell one who comes later what is in effect', async () => {
    await start()

    records.two = { addresses: ['10.0.0.3'], ttl: 5 }

    await tick(SETTLE + INTERVAL)

    Name.of('two', timing).follow(followerOf())

    expect(await Name.of('two', timing).start()).toStrictEqual('10.0.0.3')
  })

  it('should be urgent for everyone when it is for one of them', async () => {
    await start()

    Name.of('two', timing).follow(followerOf(true))
    records.two = { addresses: ['10.0.0.3'], ttl: 5 }

    await tick()

    expect(follower.change).toHaveBeenCalledWith('two', '10.0.0.3')
  })

  it('should go on while anyone follows it', async () => {
    await start()

    const other = followerOf()

    Name.of('two', timing).follow(other)
    leave()

    records.two = { addresses: ['10.0.0.3'], ttl: 5 }

    await tick(SETTLE + INTERVAL)

    expect(other.change).toHaveBeenCalledWith('two', '10.0.0.3')
    expect(follower.change).not.toHaveBeenCalled()
  })
})

describe('timing', () => {
  it('should settle for the longest TTL seen', async () => {
    records.two = { addresses: ['10.0.0.2'], ttl: 3600 }

    await start({})

    records.two = { addresses: ['10.0.0.2'], ttl: 10 }

    await tick(300_000)

    expect(name.settle).toStrictEqual(3_600_000)
    expect(name.period).toStrictEqual(3_600_000)
  })

  it('should settle for no less than 15 minutes', async () => {
    await start({})

    expect(name.settle).toStrictEqual(900_000)
  })

  it('should give a name answered without a TTL 30 minutes', async () => {
    records.two = { addresses: ['10.0.0.2'] }

    await start({})

    expect(name.settle).toStrictEqual(1_800_000)
  })

  it('should resolve every 5 minutes unless told otherwise', async () => {
    await start({})

    expect(name.interval).toStrictEqual(300_000)
  })

  it('should take what it is told', async () => {
    await start({ interval: 1, settle: 2 })

    expect([name.interval, name.settle]).toStrictEqual([1, 2])
  })
})
