'use strict'

const { generate } = require('randomstring')
const tomato = require('@toa.io/tomato')
const { command } = require('./command.mock')
const mock = { tomato, command }

jest.mock('@cucumber/cucumber', () => mock.tomato)
jest.mock('@toa.io/command', () => mock.command)

jest.setTimeout(10000)

require('../broker')

const context = /** @type {comq.features.Context} */ {}

beforeEach(() => {
  jest.clearAllMocks()
})

describe.each([false, true])('Given the broker is/has {status} #shards:%s', (sharded) => {
  const step = tomato.steps.Gi('the broker is/has {status}')

  const containerNumber = sharded ? 1 : 0

  it('should be', async () => undefined)

  beforeEach(() => {
    context.io = generate()

    if (sharded) {
      context.sharded = true
      context.shard = containerNumber
    }
  })

  it('should start comq-rmq container', async () => {
    command.execute.mockImplementationOnce(async () => undefined)
    command.execute.mockImplementationOnce(async () => ({ output: 'healthy' }))

    await step.call(context, 'up')

    expect(command.execute).toHaveBeenCalledWith('docker start comq-rmq-' + containerNumber)
  })

  it('should wait for healthy state', async () => {
    let starting = false
    let healthy = false

    command.execute.mockImplementationOnce(async () => undefined)

    command.execute.mockImplementationOnce(async () => {
      starting = true

      return { output: 'starting' }
    })

    command.execute.mockImplementationOnce(async () => {
      healthy = true

      return { output: 'healthy' }
    })

    await step.call(context, 'up')

    expect(command.execute).toHaveBeenCalledTimes(3)
  })

  it('should stop comq-rmq container', async () => {
    await step.call(context, 'down')

    expect(command.execute).toHaveBeenCalledWith('docker stop comq-rmq-' + containerNumber)
  })

  it('should kill comq-rmq-0 container', async () => {
    await step.call(context, 'crashed')

    expect(command.execute).toHaveBeenCalledWith('docker kill comq-rmq-' + containerNumber)
  })
})

describe('Given one of the brokers is/has {status}', () => {
  const step = tomato.steps.Gi('one of the brokers is/has {status}')

  it('should store picked broker', async () => {
    await step.call(context, 'down')

    expect(context.shard).toStrictEqual(expect.any(Number))
  })

  it('should start one of the containers', async () => {
    command.execute.mockImplementationOnce(async () => undefined)
    command.execute.mockImplementationOnce(async () => ({ output: 'healthy' }))

    await step.call(context, 'up')

    expect(command.execute).toHaveBeenCalledWith('docker start comq-rmq-' + context.shard)
  })
})
