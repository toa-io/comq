'use strict'

/**
 * Writes as one what a connection sends in one turn of the event loop.
 *
 * amqplib hands its frames to the socket one write at a time, and a request served is two of
 * them: the reply, and the acknowledgement of the request it answers. With Nagle's algorithm off,
 * which is what a socket sending without delay runs under, each is a syscall and a packet of its
 * own. Corked, they are held in the socket's buffer and leave together, in one `writev`, at the
 * end of the same turn: nothing waits for a timer, and nothing waits for a write that may never
 * come.
 *
 * This belongs in amqplib, whose `Mux` writes the frames one at a time, and where corking that
 * loop is six lines and needs no wrapping of a socket the library does not own. It is done here
 * until amqplib carries it, and goes when it does.
 *
 * @param {import('node:net').Socket} socket
 */
function batch (socket) {
  // whatever a connection is carried over is left as it is unless it is a stream that corks
  if (!corkable(socket) || socket[BATCHED] === true) return

  socket[BATCHED] = true

  const write = socket.write.bind(socket)

  const flush = () => {
    socket[CORKED] = false
    socket.uncork()
  }

  const cork = () => {
    if (socket[CORKED] === true) return

    socket[CORKED] = true
    socket.cork()

    process.nextTick(flush)
  }

  socket.write = (...args) => {
    cork()

    return write(...args)
  }
}

/**
 * @param {any} socket
 * @returns {boolean}
 */
function corkable (socket) {
  return socket !== null && socket !== undefined &&
    typeof socket.write === 'function' &&
    typeof socket.cork === 'function' &&
    typeof socket.uncork === 'function'
}

const BATCHED = Symbol('comq.batched')
const CORKED = Symbol('comq.corked')

exports.batch = batch
