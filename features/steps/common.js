'use strict'

const { When } = require('@cucumber/cucumber')
const { timeout } = require('@toa.io/generic')

When('after {number}ms',
  /**
   * @param {number} delay
   */
  async function (delay) {
    await timeout(delay)
  })
