'use strict'

const { Transform } = require('node:stream')
const stream = require('node:stream/promises')

/**
 * @param {import('node:stream').Readable} source
 * @param {(chunk: any) => any | Promise<any>} transform
 * @param {comq.Channel} channel
 * @returns {Pipeline}
 */
function pipeline (source, transform, channel) {
  const destination = new Pipeline(transform)

  // eslint-disable-next-line no-void
  void stream.pipeline(source, destination)

  channel.diagnose('pause', source.pause.bind(source))
  channel.diagnose('resume', source.resume.bind(source))

  return destination
}

/**
 * @param {import('node:stream').Readable} source
 * @param {(chunk: any) => any | Promise<any>} transform
 * @param {comq.Channel} channel
 * @returns {Promise<void>}
 */
async function transform (source, transform, channel) {
  const readable = pipeline(source, transform, channel)

  // eslint-disable-next-line no-void, no-unused-vars
  for await (const _ of readable) void 0
}

class Pipeline extends Transform {
  #transform

  constructor (transform) {
    super({ objectMode: true })

    this.#transform = transform
  }

  _transform (request, _, callback) {
    const promise = this.#transform(request)

    this.push(promise)
    callback()
  }
}

exports.pipeline = pipeline
exports.transform = transform
