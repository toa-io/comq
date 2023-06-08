import * as _diagnostics from '../../../types/diagnostic'
import * as _io from '../../../types/io'
import * as _amqp from '../../../types/amqp'

declare namespace comq.features {

  interface Context {
    io?: _io.IO
    connected?: boolean
    connecting: Promise<any>
    requestsSent: Promise<any>[]
    reply?: Promise<any>
    published?: Buffer
    eventsPublishedCount: number
    eventsConsumedCount: number
    consumed?: Record<string, { payload: any, properties?: _amqp.Properties }>
    consumedCount: number
    events?: { [K in _diagnostics.event]?: boolean }
    exception?: Error
    consumptionPromise?: Promise<any>
    sharded: boolean
    shard: number
    sealing: Promise<any>
    sending: any
    publishing: any

    connect(user?: string, password?: string): Promise<void>
    join(user?: string, password?: string): Promise<void>
    disconnect(): Promise<void>
  }

}
