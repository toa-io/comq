'use strict'

const { generate } = require('randomstring')
const tomato = require('@toa.io/tomato')
const { command } = require('./command.mock')
const mock = { tomato, command }

jest.mock('@cucumber/cucumber', () => mock.tomato)
jest.mock('@toa.io/command', () => mock.command)

jest.setTimeout(10000)

require('../broker')

const context = {}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the broker is/has {status}', () => {
  const step = tomato.steps.Gi('the broker is/has {status}')

  it('should be', async () => undefined)

  beforeEach(() => {
    context.io = generate()
  })

  it('should start comq-rmq-0 container', async () => {
    command.execute.mockImplementationOnce(async () => undefined)
    command.execute.mockImplementationOnce(async () => ({ output: 'healthy' }))

    await step.call(context, 'up')

    expect(command.execute).toHaveBeenCalledWith('docker start comq-rmq-0')
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

  it('should stop comq-rmq-0 container', async () => {
    await step.call(context, 'down')

    expect(command.execute).toHaveBeenCalledWith('docker stop comq-rmq-0')
  })

  it('should kill comq-rmq-0 container', async () => {
    await step.call(context, 'crashed')

    expect(command.execute).toHaveBeenCalledWith('docker kill comq-rmq-0')
  })
})
