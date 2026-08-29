'use strict'

const { Given, When } = require('@cucumber/cucumber')
const { BROKERS_AMOUNT } = require('./brokers')
const { Network } = require('./networks')

Given('a network that can go silent',
  /**
   * @this {comq.features.Context}
   */
  async function () {
    for (let n = 0; n < BROKERS_AMOUNT; n++) {
      const network = new Network(n)

      await network.open()

      this.networks[n] = network
    }
  })

When('the network goes silent',
  /**
   * @this {comq.features.Context}
   */
  function () {
    silence.call(this)
  })

// a request that is answered over a connection that is already silent proves
// nothing, hence the window between the two is left as short as a step boundary
When('the consumer sends a request to the {token} queue as the network goes silent',
  /**
   * @param {string} queue
   * @this {comq.features.Context}
   */
  function (queue) {
    this.reply = this.io.request(queue, 'hello')

    silence.call(this)
  })

/**
 * @this {comq.features.Context}
 */
function silence () {
  // only a connection lost from now on counts as lost
  delete this.events.close

  for (const network of this.networks) network.silence()
}
