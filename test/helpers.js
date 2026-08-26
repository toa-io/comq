'use strict'

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const immediate = () => new Promise((resolve) => setImmediate(resolve))

const random = (max = 100) => Math.floor(Math.random() * max)

const flip = () => Math.random() < 0.5

const sample = (array) => array[Math.floor(Math.random() * array.length)]

const quantity = (input) => {
  const matched = String(input).match(/^(\d+(?:\.\d+)?)([^\d\W]*)$/)

  if (matched === null) {
    throw new Error(`'${input}' doesn't look like a quantity of something`)
  }

  const number = +matched[1]
  const suffix = matched[2]

  if (suffix.length === 0) {
    return number
  }

  const pair = MULTIPLIERS.find(([unit]) => suffix.startsWith(unit))

  if (pair === undefined) {
    throw new Error(`'${suffix}' doesn't look like a quantity unit`)
  }

  return number * pair[1]
}

const match = (reference, candidate) => {
  if (typeof candidate !== typeof reference) {
    return false
  }

  if (Array.isArray(candidate)) {
    return Array.isArray(reference) &&
      candidate.every((value) => reference.some((item) => match(item, value)))
  }

  if (typeof candidate === 'object') {
    if (candidate === null) {
      return reference === null
    }

    if (reference === null) {
      return false
    }

    return Object.entries(candidate).every(([key, value]) => match(reference[key], value))
  }

  return reference === candidate
}

const MULTIPLIERS = Object.entries({
  k: 1000,
  Ki: 1024,
  K: 1024,
  Mi: 1024 ** 2,
  M: 1000 ** 2,
  Gi: 1024 ** 3,
  G: 1000 ** 3
})

exports.timeout = timeout
exports.immediate = immediate
exports.random = random
exports.flip = flip
exports.sample = sample
exports.quantity = quantity
exports.match = match
