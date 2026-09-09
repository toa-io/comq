declare namespace comq {

  namespace topology {

    type type = 'request' | 'reply' | 'event'

    type Set = {
      [K in type]: Topology
    }

    /** Per channel type overrides of the presets, as passed to `connect`. */
    type Overrides = {
      [K in type]?: Partial<Topology>
    }

  }

  type Topology = {
    prefetch: number
    confirms: boolean
    durable: boolean
    acknowledgments: boolean
    persistent: boolean

    /**
     * How long a failed message waits before it is delivered again, in milliseconds:
     * one entry per retry, so **the length of the ladder is the number of retries** and
     * four rungs is five attempts. A bare number is a ladder of one, hence a single retry.
     *
     * Each distinct value is a retry queue of its own, because the wait is the queue's
     * `x-message-ttl` rather than the message's, and a queue holds one of those.
     */
    delay: number | number[]
  }

}

export type type = comq.topology.type
export type Overrides = comq.topology.Overrides
