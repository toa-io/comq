import { connect } from 'comq'
import { url } from '../const.js'

const group = process.argv[2]

let io

async function run () {
  io = await connect(url)

  console.log('Connected')

  await io.consume('random_numbers', group, consume)

  console.log('Waiting for random numbers ' + (group ? 'as ' + group : 'exclusively'))

  process.on('SIGINT', exit)
}

function consume (number) {
  console.log('Received random number ' + number)
}

async function exit () {
  await io.close()

  console.log('\nDisconnected')
}

await run()
