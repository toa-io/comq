import * as _diagnostics from '../../../types/diagnostic'
import * as _io from '../../../types/io'

declare namespace comq.features {

  interface Context {
    io?: _io.IO
    connected?: boolean
    connecting: Promise<any>
    requestsSent: Promise<any>[]
    reply?: Promise<any>
    published?: any
    eventsPublishedCount: number
    eventsConsumedCount: number
    consumed?: Record<string, any>
    consumedCount: number
    events?: { [K in _diagnostics.event]?: boolean }
    exception?: Error
    expected?: Promise<any>
    sharded: boolean
    shard: number
    sealing: Promise<any>
    sending: any
    publishing: any

    connect(user?: string, password?: string): Promise<void>
    disconnect(): Promise<void>
  }

}
