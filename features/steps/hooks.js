'use strict'

const { BeforeAll, After, AfterAll } = require('@cucumber/cucumber')
const { startBrokers, stopBrokers, actions, BROKERS_AMOUNT } = require('./brokers')

BeforeAll({ timeout: 120_000 }, async function () {
  await startBrokers()
})

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await Promise.all(
      Array.from({ length: BROKERS_AMOUNT }, (_, n) => actions.up(n))
    )

    await this.disconnect()
  })

AfterAll(async function () {
  await stopBrokers()
})
