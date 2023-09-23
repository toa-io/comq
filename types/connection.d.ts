import * as _channel from './channel'
import * as _io from './io'
import * as _diagnostics from './diagnostic'
import * as _topology from './topology'

declare namespace comq {

  interface Connection {
    open(): Promise<void>

    close(): Promise<void>

    createChannel(type: _topology.type): Promise<_channel.Channel>

    createChannel(type: _topology.type, index: number): Promise<_channel.Channel>

    diagnose(event: _diagnostics.Event, listener: Function): void
  }

  type connect = (...urls: string[]) => Promise<_io.IO>

}

export type connect = comq.connect
