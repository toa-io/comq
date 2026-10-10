'use strict'

/**
 * Expands the ranges in the host of a URL into a URL per number: `amqp://rmq[0..3].example.com`
 * is `rmq0`, `rmq1` and `rmq2`. The end is exclusive, so a range starting at zero names as many
 * hosts as its end says. A start written with leading zeros pads every number to its width.
 *
 * Only the host is looked at: credentials, a path and a query are free to contain anything, and
 * an IPv6 literal, which is bracketed as well, has no `..` in it.
 *
 * @param {string} url
 * @return {string[]}
 */
function expand (url) {
  const parts = url.match(AUTHORITY)

  if (parts === null) return [url]

  const [, head, host, tail] = parts

  return hosts(host).map((host) => head + host + tail)
}

/**
 * @param {string} host
 * @return {string[]}
 */
function hosts (host) {
  const range = host.match(RANGE)

  if (range === null) return [host]

  const [expression, from, to] = range
  const start = Number(from)
  const end = Number(to)

  if (end <= start) throw new RangeError(`Range ${expression} names no hosts: its end is exclusive`)

  const width = from.length > 1 && from.startsWith('0') ? from.length : 0
  const before = host.slice(0, range.index)
  const after = host.slice(range.index + expression.length)
  const expanded = []

  for (let n = start; n < end; n++) {
    // whatever follows may hold a range of its own
    for (const rest of hosts(after)) expanded.push(before + String(n).padStart(width, '0') + rest)
  }

  return expanded
}

/** What precedes the host, the host with its port, and what follows. */
const AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?)([^/?#]*)(.*)$/i

const RANGE = /\[(\d+)\.\.(\d+)]/

exports.expand = expand
