import { connect } from 'comq'
import { url } from '../const.js'

let io

async function run () {
  io = await connect(url)

  console.log('Connected')

  await io.reply('get_numbers', produce)

  console.log('Waiting for requests...')

  process.on('SIGINT', exit)
}

async function * produce ({ limit }) {
  console.log('Request received with limit:', limit)

  for (let i = 0; i < limit; i++) yield i
}

async function exit () {
  await io.close()

  console.log('\nDisconnected')
}

await run()
