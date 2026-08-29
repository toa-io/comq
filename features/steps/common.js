'use strict'

const { When } = require('@cucumber/cucumber')
const { timeout } = require('../../test/helpers')

When('after {number}ms',
  /**
   * @param {number} delay
   */
  async function (delay) {
    await timeout(delay)
  })
