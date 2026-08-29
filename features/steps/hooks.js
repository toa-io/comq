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
    delete global.COMQ_TESTING_WATCHDOG_INTERVAL
    delete global.COMQ_TESTING_AMQP_HEARTBEAT
    delete global.COMQ_TESTING_AMQP_CHANNEL_MAX

    await Promise.all(
      Array.from({ length: BROKERS_AMOUNT }, (_, n) => actions.up(n))
    )

    await this.disconnect()
    await this.unplug()
  })

AfterAll(async function () {
  await stopBrokers()
})
