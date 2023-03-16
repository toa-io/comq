declare namespace comq {

  namespace topology {

    type type = 'request' | 'reply' | 'event'

  }

  type Topology = {
    prefetch: number
    confirms: boolean
    durable: boolean
    acknowledgments: boolean
    persistent: boolean
  }

}

export type type = comq.topology.type
