import { connect } from 'comq'
import { url } from '../const.js'

let io
let interval

const INTERVAL = 1000

async function run () {
  io = await connect(url)

  console.log('Connected')

  interval = setInterval(emit, INTERVAL)

  process.on('SIGINT', exit)
}

async function emit () {
  const number = Math.round(Math.random() * 100)

  await io.emit('random_numbers', number)

  console.log(`Random number ${number} is emitted`)
}

async function exit () {
  clearInterval(interval)

  await io.close()

  console.log('\nDisconnected')
}

await run()
