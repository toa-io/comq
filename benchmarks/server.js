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

const io = await connect(url)

await io.reply('comq.benchmark.echo', (payload) => {
  answered++

  return payload
})

// read before and after a window, so what is reported is what that window cost
await io.reply('comq.benchmark.meter', () => ({ answered, cpu: process.cpuUsage(), ...counters }))

process.send?.('ready')
console.log('ready')
