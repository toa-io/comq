// The peer under measurement: it answers an echo, and reports what answering cost it.
//
// The socket's write methods are counted here rather than in the library, because what a message
// costs a process is mostly the syscalls it makes: a reply and the acknowledgement of the request
// it answers are two writes unless something puts them together.

import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { connect } = require('../source/index.js')

const counters = { write: 0, writev: 0, chunks: 0 }
const write = net.Socket.prototype._write
const writev = net.Socket.prototype._writev

net.Socket.prototype._write = function (...args) {
  counters.write++
  counters.chunks++

  return write.apply(this, args)
}

net.Socket.prototype._writev = function (chunks, ...rest) {
  counters.writev++
  counters.chunks += chunks.length

  return writev.apply(this, [chunks, ...rest])
}

const url = process.env.COMQ_BENCHMARK_URL ?? 'amqp://developer:secret@localhost:5673'

let answered = 0

/** What a value of a reply stream carries: a record, as a set read whole is made of. */
const VALUE = {
  id: '4c4759e6f9c74da989d64511df42d6f4',
  title: 'First pot',
  rank: 7,
  public: true,
  tags: ['one', 'two', 'three']
}

const io = await connect(url)

await io.reply('comq.benchmark.echo', (payload) => {
  answered++

  return payload
})

// a reply stream of the values a caller asks for, each the size of an echo's payload
await io.reply('comq.benchmark.stream', function * ({ length }) {
  for (let i = 0; i < length; i++) yield { ...VALUE, i }
})

// read before and after a window, so what is reported is what that window cost
await io.reply('comq.benchmark.meter', () => ({ answered, cpu: process.cpuUsage(), ...counters }))

process.send?.('ready')
console.log('ready')
