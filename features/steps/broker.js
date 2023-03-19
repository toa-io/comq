'use strict'

const { timeout } = require('@toa.io/generic')
const { execute } = require('@toa.io/command')

const { Given } = require('@cucumber/cucumber')

Given('the broker is/has {status}',
  /**
   * @param {'up' | 'down'} status
   * @this {comq.features.Context}
   */
  async function (status) {
    await actions[status](this)
  })

const actions = {
  up: async () => {
    await execute('docker start comq-rmq-0')
    await healthy()
  },
  down: async () => {
    await execute('docker stop comq-rmq-0')
  },
  crashed: async () => {
    await execute('docker kill comq-rmq-0')
  }
}

async function healthy () {
  let process

  do {
    await timeout(1000)

    process = await execute('docker inspect -f {{.State.Health.Status}} comq-rmq-0')
  } while (process.output !== 'healthy')
}
