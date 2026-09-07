'use strict'

const { Transform } = require('node:stream')
const stream = require('node:stream/promises')

function pipeline (source, transform, channel) {
  const destination = new Pipeline(transform)
  const pause = source.pause.bind(source)
  const resume = source.resume.bind(source)

  channel.diagnose('pause', pause)
  channel.diagnose('resume', resume)

  // the source must not outlive the pipeline as a listener of the channel;
  // a failure is delivered through the destination, the promise says nothing new
  const detach = () => {
    channel.forget('pause', pause)
    channel.forget('resume', resume)
  }

  stream.pipeline(source, destination).then(detach, detach)

  return destination
}

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
