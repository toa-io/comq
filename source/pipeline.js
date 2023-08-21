'use strict'

const { Transform } = require('node:stream')
const stream = require('node:stream/promises')

function pipeline (source, transform, channel) {
  const destination = new Pipeline(transform)

  // eslint-disable-next-line no-void
  void stream.pipeline(source, destination)

  channel.diagnose('pause', source.pause.bind(source))
  channel.diagnose('resume', source.resume.bind(source))

  return destination
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
