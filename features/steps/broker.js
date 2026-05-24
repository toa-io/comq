'use strict'

const { random } = require('@toa.io/generic')

const { Given } = require('@cucumber/cucumber')
const { BROKERS_AMOUNT, actions } = require('./brokers')

Given('the broker is/has {status}',
  /**
   * @param {'up' | 'down' | 'crashed'} status
   * @this {comq.features.Context}
   */
  async function (status) {
    const n = this.shard ?? 0

    await actions[status](n)
  })

Given('one of the brokers is/has {status}',
  /**
   * @param {'up' | 'down' | 'crashed'} status
   * @this {comq.features.Context}
   */
  async function (status) {
    const shard = random(BROKERS_AMOUNT)

    this.shard = shard

    await actions[status](shard)
  })
