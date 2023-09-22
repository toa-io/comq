import { connect } from 'comq'
import { url } from '../const.js'

let io
let interval

const INTERVAL = 1000

async function run () {
  io = await connect(url)

  console.log('Connected')

  interval = setInterval(fetch, INTERVAL)

  process.on('SIGINT', exit)
}

async function fetch () {
  const limit = Math.round(Math.random() * 9 + 1)

  console.log(`Fetching a stream with ${limit} numbers`)

  const stream = await io.fetch('get_numbers', { limit })
  const numbers = []

  for await (const number of stream) numbers.push(number)

  console.log(`Stream received: ${numbers.join(', ')}`)
}

async function exit () {
  clearInterval(interval)

  await io.close()

  console.log('\nDisconnected')
}

await run()
