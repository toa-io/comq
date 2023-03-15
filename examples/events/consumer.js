'use strict'

const { randomBytes } = require('node:crypto')
const { connect } = require('comq')
const { url } = require('../const')

const group = process.argv[2] ?? randomBytes(4).toString('hex')

let io

async function run () {
  io = await connect(url)

  console.log('Connected')

  await io.consume('random_numbers', group, consume)

  console.log('Waiting for random numbers as ' + group)

  process.on('SIGINT', exit)
}

function consume (number) {
  console.log('Received random number ' + number)
}

async function exit () {
  await io.close()

  console.log('\nDisconnected')
}

run().then()
