'use strict'

const { connect } = require('comq')
const { url } = require('../const')

let io
let interval

const INTERVAL = 1000

async function run () {
  io = await connect(url)

  console.log('Connected')

  interval = setInterval(send, INTERVAL)

  process.on('SIGINT', exit)
}

async function send () {
  const a = Math.round(Math.random() * 100)
  const b = Math.round(Math.random() * 100)

  console.log(`Sending request with ${a} and ${b}`)

  const reply = await io.request('add_numbers', { a, b })

  console.log(`Reply received, ${a} + ${b} equals ${reply}`)
}

async function exit () {
  clearInterval(interval)

  await io.close()

  console.log('\nDisconnected')
}

run().then()
