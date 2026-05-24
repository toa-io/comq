'use strict'

const { BeforeAll, After, AfterAll } = require('@cucumber/cucumber')
const { startBrokers, stopBrokers } = require('./brokers')

BeforeAll({ timeout: 120_000 }, async function () {
  await startBrokers()
})

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.disconnect()
  })

AfterAll(async function () {
  await stopBrokers()
})
