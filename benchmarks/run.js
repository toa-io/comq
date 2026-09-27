// What one request costs the process that answers it. See readme.md.
//
// node benchmarks/run.js [--rates 1000,5000] [--concurrency 1,8] [--messages 20000]
// [--seconds 6] [--rounds 2] [--streams 8000]

import { fork } from 'node:child_process'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const { connect } = require('../source/index.js')

const { values } = parseArgs({
  options: {
    rates: { type: 'string', default: '1000,5000,20000,40000' },
    concurrency: { type: 'string', default: '1,8,64,256' },
    messages: { type: 'string', default: '20000' },
    seconds: { type: 'string', default: '6' },
    rounds: { type: 'string', default: '2' },
    streams: { type: 'string', default: '' }
  }
})

const url = process.env.COMQ_BENCHMARK_URL ?? 'amqp://developer:secret@localhost:5673'
const rates = numbers(values.rates)
const concurrencies = numbers(values.concurrency)
const messages = Number(values.messages)
const seconds = Number(values.seconds)
const rounds = Number(values.rounds)
const streams = values.streams === '' ? [] : numbers(values.streams)

const durations = []

/** What a request carries, which is small, as a call between components is. */
const payload = {
  id: '4c4759e6f9c74da989d64511df42d6f4',
  title: 'First pot',
  rank: 7,
  public: true,
  tags: ['one', 'two', 'three']
}

const server = await start()
const io = await connect(url)

try {
  const open = []
  const closed = []
  const streamed = []

  for (let round = 1; round <= rounds; round++) {
    if (streams.length > 0) {
      for (const length of streams) streamed.push(await stream(length, round))

      continue
    }

    for (const rate of rates) open.push(await atRate(rate, round))
    for (const concurrency of concurrencies) closed.push(await inFlight(concurrency, round))
  }

  if (streams.length > 0) reportStreams(streamed)
  else {
    report('At a fixed rate', ['rate'], open)
    report('With requests in flight', ['in flight'], closed)
  }
} finally {
  await io.close()

  server.kill()
}

/**
 * Requests sent at a rate, as traffic arrives: a millisecond's worth at a time, none of them
 * waited for. What a peer costs per message is read from the peer itself.
 */
async function atRate (rate, round) {
  await load(() => send(rate, 2, false))

  const measured = await load(() => send(rate, seconds, true))

  return { round, of: rate, ...measured }
}

/** Requests kept in flight, as a queue of callers is: the peer is never idle between them. */
async function inFlight (concurrency, round) {
  await load(() => saturate(concurrency, Math.min(5000, messages), false))

  const measured = await load(() => saturate(concurrency, messages, true))

  return { round, of: concurrency, ...measured }
}

/** A window: what the peer spent, and what the caller waited, between two readings. */
async function load (work) {
  durations.length = 0

  const before = await io.request('comq.benchmark.meter', null)
  const started = process.hrtime.bigint()

  await work()

  const elapsed = Number(process.hrtime.bigint() - started) / 1e9
  const after = await io.request('comq.benchmark.meter', null)
  const answered = after.answered - before.answered
  const cpu = after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system

  return {
    answered,
    rate: Math.round(answered / elapsed),
    cpu: round2(cpu / answered),
    writes: round3((after.write - before.write) / answered),
    writevs: round3((after.writev - before.writev) / answered),
    p50: percentile(0.5),
    p99: percentile(0.99)
  }
}

/**
 * A reply stream of `length` values, read to its end: what it cost the peer that sent it and this
 * process that read it, per value, and how long it took.
 */
async function stream (length, round) {
  await readStream(Math.min(length, 1000))

  const before = await io.request('comq.benchmark.meter', null)
  const cpu = process.cpuUsage()
  const started = process.hrtime.bigint()

  await readStream(length)

  const elapsed = Number(process.hrtime.bigint() - started) / 1e6
  const consumer = process.cpuUsage(cpu)
  const after = await io.request('comq.benchmark.meter', null)
  const producer = after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system

  return {
    round,
    of: length,
    ms: round2(elapsed),
    producer: round2(producer / length),
    consumer: round2((consumer.user + consumer.system) / length),
    writes: round3((after.write + after.writev - before.write - before.writev) / length)
  }
}

async function readStream (length) {
  const reply = await io.request('comq.benchmark.stream', { length })

  let read = 0

  // eslint-disable-next-line no-unused-vars
  for await (const _ of reply) read++

  if (read !== length) throw new Error(`The stream held ${read} values of ${length}`)
}

function reportStreams (rows) {
  console.log('\n## A reply stream\n')
  console.log('| values | round | ms | producer CPU µs | consumer CPU µs | writes |')
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: |')

  for (const row of rows) {
    console.log(`| ${row.of} | ${row.round} | ${row.ms} | ${row.producer} | ${row.consumer} | ` +
      `${row.writes} |`)
  }
}

async function send (rate, duration, record) {
  const started = process.hrtime.bigint()
  const pending = []

  let sent = 0

  while (elapsed(started) < duration) {
    const due = Math.round(elapsed(started) * rate)

    while (sent < due) {
      sent++
      pending.push(request(record))
    }

    await sleep(1)
  }

  await Promise.all(pending)
}

async function saturate (concurrency, count, record) {
  let sent = 0

  const caller = async () => {
    while (sent < count) {
      sent++

      await request(record)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, caller))
}

async function request (record) {
  const at = process.hrtime.bigint()

  await io.request('comq.benchmark.echo', payload)

  if (record) durations.push(Number(process.hrtime.bigint() - at) / 1e6)
}

function report (title, columns, rows) {
  console.log(`\n## ${title}\n`)
  console.log(`| ${columns[0]} | round | messages/s | CPU µs | writes | writev | p50 ms | p99 ms |`)
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')

  for (const row of rows) {
    console.log(`| ${row.of} | ${row.round} | ${row.rate} | ${row.cpu} | ${row.writes} | ` +
      `${row.writevs} | ${row.p50} | ${row.p99} |`)
  }
}

/** The peer in a process of its own, which is where its CPU is measured. */
async function start () {
  const child = fork(new URL('server.js', import.meta.url), { stdio: 'inherit' })

  await new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('exit', (code) => reject(new Error(`The peer exited with ${code}`)))
  })

  return child
}

function percentile (share) {
  // a warm-up window records nothing, and its result is discarded
  if (durations.length === 0) return 0

  const sorted = durations.slice().sort((a, b) => a - b)

  return round3(sorted[Math.floor(sorted.length * share)])
}

function elapsed (since) {
  return Number(process.hrtime.bigint() - since) / 1e9
}

function numbers (list) {
  return list.split(',').map(Number)
}

function round2 (value) {
  return Number(value.toFixed(2))
}

function round3 (value) {
  return Number(value.toFixed(3))
}
