'use strict'

const { After } = require('@cucumber/cucumber')

After(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await this.disconnect()
  })
