'use strict'

const net = require('node:net')
const { getAddress } = require('./brokers')

/**
 * A network that can go silent, which is what a machine that woke from sleep is
 * left with: the socket stays open, nothing is delivered over it, and neither
 * the broker nor the operating system reports anything. Stopping, killing or
 * pausing a broker does not reproduce it, since all three end up closing the
 * socket the moment the connection is used.
 */
class Network {
  /** @type {net.Server} */
  #server

  /** @type {Set<comq.features.Tunnel>} */
  #tunnels = new Set()

  /** @type {string} */
  #host

  /** @type {number} */
  #port

  /**
   * @param {number} [n] broker index
   */
  constructor (n = 0) {
    const [host, port] = getAddress(n).split(':')

    this.#host = host
    this.#port = Number(port)
  }

  get address () {
    return 'localhost:' + this.#server.address().port
  }

  async open () {
    this.#server = net.createServer(this.#tunnel)

    await new Promise((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
  }

  /**
   * Only the tunnels that are already open go silent: a connection established
   * afterwards is forwarded as usual, just as it is once a machine is awake.
   */
  silence () {
    for (const tunnel of this.#tunnels) tunnel.silent = true
  }

  async close () {
    for (const tunnel of this.#tunnels) this.#collapse(tunnel)

    await new Promise((resolve) => this.#server.close(resolve))
  }

  /**
   * @param {net.Socket} client
   */
  #tunnel = (client) => {
    const upstream = net.connect(this.#port, this.#host)

    /** @type {comq.features.Tunnel} */
    const tunnel = { client, upstream, silent: false }

    this.#tunnels.add(tunnel)

    client.on('data', (chunk) => { if (!tunnel.silent) upstream.write(chunk) })
    upstream.on('data', (chunk) => { if (!tunnel.silent) client.write(chunk) })

    for (const socket of [client, upstream]) {
      socket.on('error', () => this.#collapse(tunnel))
      socket.on('close', () => this.#collapse(tunnel))
    }
  }

  /**
   * @param {comq.features.Tunnel} tunnel
   */
  #collapse (tunnel) {
    this.#tunnels.delete(tunnel)
    tunnel.client.destroy()
    tunnel.upstream.destroy()
  }
}

exports.Network = Network
