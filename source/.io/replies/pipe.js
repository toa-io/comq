'use strict'

const { control, HEARTBEAT_INTERVAL } = require('./const')

/**
 * @param {comq.amqp.Message} request
 * @param {stream.Readable} stream
 * @param {comq.Channel} channel
 * @param {(message: any, properties?: comq.amqp.options.Publish) => Promise<void>} send
 * @return {Promise<void>}
 */
async function pipe (request, stream, channel, send) {
  let index = -1
  let interrupt = false

  const heartbeatInterval = global['COMQ_TESTING_HEARTBEAT_INTERVAL'] || HEARTBEAT_INTERVAL

  /** @type {Record<string, comq.amqp.options.Publish>} */
  const properties = {
    chunk: { correlationId: request.properties.correlationId, mandatory: true },
    control: { correlationId: request.properties.correlationId, type: 'control', mandatory: true }
  }

  channel.diagnose('return', (message) => {
    if (message.fields.routingKey === request.properties.replyTo)
      interrupt = true
  })

  async function transmit (data, properties) {
    index++

    const ok = await send(data, { ...properties, headers: { index } })

    if (!ok) cancel()
  }

  function cancel () {
    interrupt = true
    stream.destroy()
  }

  /** @type {ReturnType<setInterval> | null} */
  let interval = null

  function heartbeat () {
    if (interval !== null) clearInterval(interval)

    interval = setInterval(
      () => transmit(control.heartbeat, properties.control),
      heartbeatInterval
    )
  }

  await transmit(control.ok, properties.control)

  heartbeat()

  for await (const chunk of stream) {
    await transmit(chunk, properties.chunk)

    heartbeat()

    if (interrupt) break
  }

  clearInterval(interval)
  if (!interrupt) await transmit(control.end, properties.control)
}

exports.pipe = pipe
