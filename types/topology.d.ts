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
     * How many times a message that caused an exception is retried before it is parked.
     * The count is the `x-attempt` header, which the first delivery does not carry, so
     * the default of `5` is one delivery followed by five retries: six in all.
     */
    attempts: number

    /** Milliseconds a failed message waits in the retry queue before it is delivered again. */
    delay: number
  }

}

export type type = comq.topology.type
export type Overrides = comq.topology.Overrides
