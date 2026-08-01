#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fg = require('fast-glob')
const fuzzysort = require('fuzzysort')

const ROOT = path.resolve(__dirname, '..')
const USAGE = 'Usage: feat <query> [name] [cucumber-args...]'

function toKey (file) {
  return path.relative(ROOT, file)
    .replace(/^features\//, '')
    .replace(/\.feature$/, '')
    .replace(/\./g, '/')
}

function normalizeQuery (query) {
  return query.replace(/\./g, '/').replace(/\\/g, '/')
}

async function main () {
  const args = process.argv.slice(2)
  const dashIndex = args.findIndex((arg) => arg.startsWith('-'))
  const positional = dashIndex === -1 ? args : args.slice(0, dashIndex)
  const query = positional[0]
  const name = positional[1]

  const cucumberArgs = [
    ...(name ? ['--name', name] : []),
    ...positional.slice(2),
    ...(dashIndex === -1 ? [] : args.slice(dashIndex))
  ]

  if (!query) {
    console.error(USAGE)
    process.exit(1)
  }

  const files = await fg('features/**/*.feature', { cwd: ROOT, absolute: true })
  const items = files.map((file) => ({ file, key: toKey(file) }))
  const result = fuzzysort.go(normalizeQuery(query), items, { key: 'key', limit: 1 })

  if (result.length === 0) {
    console.error(`No feature files match "${query}"`)
    process.exit(1)
  }

  const selected = result.map(({ obj }) => obj.file)

  for (const file of selected) { console.error(path.relative(ROOT, file)) }

  const cucumberBin = path.join(ROOT, 'node_modules', '.bin', 'cucumber-js')

  const run = spawnSync(cucumberBin, [...selected, ...cucumberArgs], {
    cwd: ROOT,
    stdio: 'inherit'
  })

  process.exit(run.status ?? 1)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
