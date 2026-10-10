import * as _channel from './channel'
import * as _io from './io'
import * as _diagnostics from './diagnostic'
import * as _topology from './topology'
import * as _shards from './shards'

declare namespace comq {

  interface Connection {
    readonly connected?: boolean
    readonly closed?: boolean

    open(): Promise<void>

    close(): Promise<void>

    createChannel(type: _topology.type): Promise<_channel.Channel>

    createChannel(type: _topology.type, index: number): Promise<_channel.Channel>

    diagnose(event: _diagnostics.Event, listener: Function): void

    forget(event: _diagnostics.Event, listener: Function): void
  }

  /** The topology presets overridden per channel type, and how the names of the shards are followed. */
  type Options = _topology.Overrides & {
    resolution?: _shards.Timing
  }

  type Connect = {
    /**
     * A range in a host is as many URLs: `amqp://rmq[0..32].example.com` is `rmq0` to `rmq31`.
     * Several URLs are the names of the shards, and a connection is made to each broker they
     * stand for.
     */
    (...urls: string[]): Promise<_io.IO>

    (...args: [...urls: string[], options: Options]): Promise<_io.IO>
  }

}

export type Connect = comq.Connect
export type Options = comq.Options
