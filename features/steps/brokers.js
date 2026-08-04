'use strict'

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { timeout } = require('@toa.io/generic')
const { RabbitMQContainer } = require('@testcontainers/rabbitmq')
const { getContainerRuntimeClient } = require('testcontainers')

const docker = promisify(execFile)

const IMAGE = 'rabbitmq:4.3-management'
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

  await Promise.all(
    Array.from({ length: BROKERS_AMOUNT }, (_, n) => healthy(n))
  )
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

  return `localhost:${HOST_PORTS[n]}`
}

/**
 * @param {number} [n]
 */
async function healthy (n = 0) {
  do {
    await timeout(HEALTHCHECK_INTERVAL)

    const { stdout } = await docker('docker', ['inspect', '-f', '{{.State.Health.Status}}', `comq-rmq-${n}`])

    if (stdout.trim() === 'healthy') return
  } while (true)
}

const actions = {
  up: async (n = 0) => {
    // a paused broker is neither stopped nor usable, and the hooks bring every
    // broker up between scenarios, so unpausing belongs here
    await docker('docker', ['unpause', `comq-rmq-${n}`]).catch(() => undefined)
    await docker('docker', ['start', `comq-rmq-${n}`])
    await healthy(n)
  },
  down: async (n = 0) => {
    await docker('docker', ['stop', `comq-rmq-${n}`])
  },
  crashed: async (n = 0) => {
    await docker('docker', ['kill', `comq-rmq-${n}`])
  },
  // a frozen broker keeps its connections open while answering nothing, which is
  // what a publisher cannot tell from a working one until the watchdog fires
  frozen: async (n = 0) => {
    await docker('docker', ['pause', `comq-rmq-${n}`])
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
