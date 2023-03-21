'use strict'

import { connect } from 'comq'
import { url } from '../const.js'

let io

async function run () {
  io = await connect(url)

  console.log('Connected')

  await io.reply('add_numbers', produce)

  console.log('Waiting for requests...')

  process.on('SIGINT', exit)
}

async function produce ({ a, b }) {
  console.log(`Request received with ${a} and ${b}`)

  return a + b
}

async function exit () {
  await io.close()

  console.log('\nDisconnected')
}

await run()
