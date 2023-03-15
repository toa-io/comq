'use strict'

const io = () => ({
  diagnose: jest.fn(() => undefined),
  close: jest.fn(async () => undefined)
})

const connect = jest.fn(async () => io())

exports.comq = { connect }
