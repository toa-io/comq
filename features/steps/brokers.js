'use strict'

const { timeout } = require('@toa.io/generic')
const { RabbitMQContainer } = require('@testcontainers/rabbitmq')
const { getContainerRuntimeClient } = require('testcontainers')

const IMAGE = 'rabbitmq:3.10.0-management'
const USER = 'developer'
const PASSWORD = 'secret'
const AMQP_PORT = 5672
const BROKERS_AMOUNT = 2
const HOST_PORTS = [5673, 5674]
const HEALTHCHECK_INTERVAL = global.COMQ_TESTING_HEALTHCHECK_INTERVAL ?? 1000

/** @type {import('@testcontainers/rabbitmq').StartedRabbitMQContainer[]} */
const brokers = []

async function startBrokers () {
  if (brokers.length > 0) return

  for (let n = 0; n < BROKERS_AMOUNT; n++) await removeStale(`comq-rmq-${n}`)

  const started = await Promise.all(
    HOST_PORTS.map((hostPort, n) =>
      new RabbitMQContainer(IMAGE)
        .withEnvironment({
          RABBITMQ_DEFAULT_USER: USER,
          RABBITMQ_DEFAULT_PASS: PASSWORD
        })
        .withAutoRemove(false)
        .withName(`comq-rmq-${n}`)
        .withExposedPorts({ container: AMQP_PORT, host: hostPort })
        .withHealthCheck({
          test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'],
          interval: 5000,
          timeout: 1000,
          retries: 5
        })
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
 * @param {string} name
 */
async function removeStale (name) {
  const client = await getContainerRuntimeClient()
  const listed = await client.container.list()

  for (const info of listed) {
    if (!info.Names.some((entry) => entry === `/${name}`)) continue

    const container = client.container.getById(info.Id)

    try {
      await client.container.stop(container, { timeout: 0 })
    } catch {
      // already stopped
    }

    await container.remove({ force: true })
  }
}

/**
 * @param {number} [n]
 * @returns {string}
 */
function getAddress (n = 0) {
  if (brokers[n] === undefined) throw new Error(`Broker ${n} is not started`)

  return `127.0.0.1:${HOST_PORTS[n]}`
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
  const client = await getContainerRuntimeClient()
  const inspect = await client.container.inspect(await getDockerContainer(n))

  return inspect.State.Running === true
}

/**
 * @param {number} [n]
 */
async function healthy (n = 0) {
  const client = await getContainerRuntimeClient()

  do {
    await timeout(HEALTHCHECK_INTERVAL)

    const inspect = await client.container.inspect(await getDockerContainer(n))

    if (inspect.State.Health?.Status === 'healthy') return
  } while (true)
}

const actions = {
  up: async (n = 0) => {
    const client = await getContainerRuntimeClient()
    const container = await getDockerContainer(n)

    if (!(await isRunning(n))) await client.container.start(container)

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
