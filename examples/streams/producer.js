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

  for (let i = 0; i < limit; i++) {
    yield i

    const timeout = Math.round(Math.random() * 1000)

    await new Promise((resolve) => setTimeout(resolve, timeout))
  }

  console.log('Stream finished')
}

async function exit () {
  await io.close()

  console.log('\nDisconnected')
}

await run()
