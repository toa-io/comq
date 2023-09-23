import { connect } from 'comq'
import { url } from '../const.js'

const limit = Number(process.argv[2]) || Math.round(Math.random() * 8 + 2)

let io
let stream

async function run () {
  io = await connect(url)

  console.log('Connected')
  process.on('SIGINT', exit)

  await fetch()
  await io.close()

  console.log('Disconnected')
}

async function fetch () {
  console.log(`Fetching stream with ${limit} numbers`)

  stream = await io.fetch('get_numbers', { limit })

  for await (const number of stream) console.log('Received:', number)

  console.log('Stream finished')
}

function exit () {
  console.log()
  stream?.destroy()
}

await run()
