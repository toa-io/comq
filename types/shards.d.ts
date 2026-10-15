import * as _connection from './connection'

declare namespace comq {

  namespace shards {

    /**
     * How the names of the shards are followed, in milliseconds. `settle` defaults to the longest
     * TTL the name is answered with, `linger` to the longest of the names, and both to no less
     * than 15 minutes.
     */
    type Timing = {
      /** how often the names are resolved, 5 minutes by default */
      interval?: number

      /** how long an answer is to hold before a broker is joined or retired on it */
      settle?: number

      /** how long a retired broker is to stay idle before it is left */
      linger?: number
    }

    /** Who follows a name, which is shared by everyone in the process who stands on it. */
    type Follower = {
      /** what the name stands for has changed for good */
      change (host: string, address: string): void

      /** the name failed to resolve, and keeps its address */
      error (exception: Error): void

      /** whether the name is of no use as it is resolved now, so that its next answer is taken at once */
      urgent (host: string): boolean
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
