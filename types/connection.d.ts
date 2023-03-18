import * as _channel from './channel'
import * as _io from './io'
import * as _diagnostics from './diagnostic'
import * as _topology from './topology'

declare namespace comq {

  interface Connection {
    open(): Promise<void>

    close(): Promise<void>

    createChannel(type: _topology.type, failfast?: boolean): Promise<_channel.Channel>

    diagnose(event: _diagnostics.event, listener: Function): void
  }

  type connect = (...urls: string[]) => Promise<_io.IO>

}

export type connect = comq.connect
