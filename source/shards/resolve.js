'use strict'

const net = require('node:net')
const dns = require('node:dns').promises

/**
 * The addresses a name stands for, and for how long the answer may be cached, in seconds.
 *
 * DNS is asked directly, since nothing else tells the TTL. A name it does not know is looked up
 * the way a socket would have, which is how a name from the hosts file or one completed by the
 * search list is found; such an answer carries no TTL.
 *
 * @param {string} host
 * @return {Promise<comq.shards.Resolution>}
 */
async function resolve (host) {
  if (global.COMQ_TESTING_LOOKUP !== undefined) return await global.COMQ_TESTING_LOOKUP(host)

  const answers = await Promise.allSettled([
    dns.resolve4(host, { ttl: true }),
    dns.resolve6(host, { ttl: true })
  ])

  const records = answers.flatMap((answer) => answer.status === 'fulfilled' ? answer.value : [])

  if (records.length > 0) {
    return {
      addresses: records.map((record) => record.address),
      ttl: Math.max(...records.map((record) => record.ttl))
    }
  }

  const found = await dns.lookup(host, { all: true })

  return { addresses: found.map((entry) => entry.address) }
}

/**
 * The one address a name is connected through. A name is one broker, and several addresses are
 * as many ways to it: the one in use is kept for as long as it is listed, and the choice is
 * otherwise the same whichever order they came in, so that the names of one broker agree on it.
 *
 * @param {string[]} addresses
 * @param {string} [current]
 * @return {string}
 */
function choose (addresses, current) {
  if (current !== undefined && addresses.includes(current)) return current

  return addresses.toSorted(order)[0]
}

/**
 * IPv4 first, which is where a broker is found whenever it has both.
 *
 * @param {string} one
 * @param {string} another
 * @return {number}
 */
function order (one, another) {
  return net.isIP(one) - net.isIP(another) || (one < another ? -1 : Number(one > another))
}

/**
 * What a URL names: the host to resolve, or nothing when it is an address already or is not
 * something that can be told.
 *
 * @param {string} url
 * @return {string | undefined}
 */
function hostOf (url) {
  const parsed = parse(url)

  if (parsed === undefined) return undefined

  const host = unbracketed(parsed.hostname)

  return host === '' || net.isIP(host) !== 0 ? undefined : host
}

/**
 * The broker a URL stands for once its name is resolved: the URL of the address, which is what
 * tells one broker from another, and the name TLS verifies it by.
 *
 * @param {string} url
 * @param {string} [address]
 * @return {comq.shards.Location}
 */
function locate (url, address) {
  const host = hostOf(url)

  if (host === undefined || address === undefined) return { url, address: addressOf(url) }

  const parsed = parse(url)

  parsed.hostname = net.isIPv6(address) ? '[' + address + ']' : address

  return { url: parsed.href, address, servername: host }
}

/**
 * @param {string} url
 * @return {string}
 */
function addressOf (url) {
  const parsed = parse(url)

  return parsed === undefined ? url : unbracketed(parsed.hostname)
}

/**
 * @param {string} url
 * @return {URL | undefined}
 */
function parse (url) {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/**
 * @param {string} hostname
 * @return {string}
 */
function unbracketed (hostname) {
  return hostname.replace(/^\[|]$/g, '')
}

exports.resolve = resolve
exports.choose = choose
exports.hostOf = hostOf
exports.locate = locate
