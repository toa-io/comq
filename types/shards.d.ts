import * as _connection from './connection'

declare namespace comq {

  namespace shards {

    /**
     * How the names of the shards are followed, in milliseconds. `settle` and `linger` default
     * to the longest TTL the names are answered with, and to no less than 30 seconds.
     */
    type Timing = {
      /** how often the names are resolved, 10 seconds by default */
      interval?: number

      /** how long an answer is to hold before a broker is joined or retired on it */
      settle?: number

      /** how long a retired broker is to stay idle before it is left */
      linger?: number
    }

    type Resolution = {
      addresses: string[]

      /** in seconds, when the answer tells */
      ttl?: number
    }

    type Location = {
      /** the URL of the address, which is what tells one broker from another */
      url: string
      address: string

      /** the name the broker is verified by */
      servername?: string
    }

    type Shard = Location & {
      index: number
      connection: _connection.Connection
      state: 'joining' | 'active' | 'retiring' | 'leaving'

      /** whether channels are made over it */
      joined: boolean

      /** when it was retired */
      since: number

      /** since when it has been out of reach, while retiring */
      down?: number
      listeners: [string, Function][]
    }

  }

}

export type Timing = comq.shards.Timing
