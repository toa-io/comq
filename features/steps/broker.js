'use strict'

const { timeout, random } = require('@toa.io/generic')
const { execute } = require('@toa.io/command')

const { Given } = require('@cucumber/cucumber')

Given('the broker is/has {status}',
  /**
   * @param {'up' | 'down'} status
   * @this {comq.features.Context}
   */
  async function (status) {
    const n = this.shard ?? 0

    await actions[status](n)
  })

Given('one of the brokers is/has {status}',
  /**
   * @param {'up' | 'down'} status
   * @this {comq.features.Context}
   */
  async function (status) {
    const shard = random(BROKERS_AMOUNT)

    this.shard = shard

    await actions[status](shard)
  })

const actions = {
  up: async (n = 0) => {
    await execute('docker start comq-rmq-' + n)
    await healthy()
  },
  down: async (n = 0) => {
    await execute('docker stop comq-rmq-' + n)
  },
  crashed: async (n = 0) => {
    await execute('docker kill comq-rmq-' + n)
  }
}

async function healthy () {
  let process

  do {
    await timeout(HEALTHCHECK_INTERVAL)

    process = await execute('docker inspect -f {{.State.Health.Status}} comq-rmq-0')
  } while (process.output !== 'healthy')

  await timeout(500)
}

const BROKERS_AMOUNT = 2
const HEALTHCHECK_INTERVAL = global.COMQ_TESTING_HEALTHCHECK_INTERVAL ?? 1000
