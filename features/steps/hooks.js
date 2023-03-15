'use strict'

const { AfterAll } = require('@cucumber/cucumber')
const { Context } = require('./context')

AfterAll(
  /**
   * @this {comq.features.Context}
   */
  async function () {
    await Context.disconnect()
  })
