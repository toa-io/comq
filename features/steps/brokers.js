'use strict'

const { timeout } = require('@toa.io/generic')
const { RabbitMQContainer } = require('@testcontainers/rabbitmq')
const { getContainerRuntimeClient } = require('testcontainers')

const IMAGE = 'rabbitmq:3.10.0-management'
const USER = 'developer'
const PASSWORD = 'secret'
const AMQP_PORT = 5672
const BROKERS_AMOUNT = 2
const HEALTHCHECK_INTERVAL = global.COMQ_TESTING_HEALTHCHECK_INTERVAL ?? 1000

/** @type {import('@testcontainers/rabbitmq').StartedRabbitMQContainer[]} */
const brokers = []

async function startBrokers () {
  if (brokers.length > 0) return

  const started = await Promise.all(
    Array.from({ length: BROKERS_AMOUNT }, () =>
      new RabbitMQContainer(IMAGE)
        .withEnvironment({
          RABBITMQ_DEFAULT_USER: USER,
          RABBITMQ_DEFAULT_PASS: PASSWORD
        })
        .withAutoRemove(false)
        .start()
    )
  )

  brokers.push(...started)
}

async function stopBrokers () {
  await Promise.all(brokers.map((broker) => broker.stop({ remove: true })))
  brokers.length = 0
}

/**
 * @param {number} [n]
 * @returns {string}
 */
function getAddress (n = 0) {
  const broker = brokers[n]

  if (broker === undefined) throw new Error(`Broker ${n} is not started`)

  return `${broker.getHost()}:${broker.getMappedPort(AMQP_PORT)}`
}

/**
 * @param {number} n
 * @returns {Promise<import('dockerode').Container>}
 */
async function getDockerContainer (n) {
  const client = await getContainerRuntimeClient()

  return client.container.getById(brokers[n].getId())
}

/**
 * @param {number} n
 * @returns {Promise<boolean>}
 */
async function isRunning (n) {
  const container = await getDockerContainer(n)
  const inspect = await container.inspect()

  return inspect.State.Running === true
}

/**
 * @param {number} [n]
 */
async function healthy (n = 0) {
  const broker = brokers[n]

  do {
    await timeout(HEALTHCHECK_INTERVAL)

    try {
      const result = await broker.exec(['rabbitmq-diagnostics', '-q', 'ping'])

      if (result.exitCode === 0) return
    } catch {
      // container may still be starting
    }
  } while (true)
}

const actions = {
  up: async (n = 0) => {
    if (!(await isRunning(n))) {
      const client = await getContainerRuntimeClient()

      await client.container.start(await getDockerContainer(n))
    }

    await healthy(n)
  },
  down: async (n = 0) => {
    if (await isRunning(n)) await brokers[n].stop({ remove: false })
  },
  crashed: async (n = 0) => {
    if (await isRunning(n)) await (await getDockerContainer(n)).kill()
  }
}

module.exports = {
  BROKERS_AMOUNT,
  USER,
  PASSWORD,
  startBrokers,
  stopBrokers,
  getAddress,
  actions
}
