import { Readable } from 'node:stream'
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
    events?: { [K in _diagnostics.Event]?: boolean }
    exception?: Error
    consumptionPromise?: Promise<any>
    sharded: boolean
    shard: number
    sealing: Promise<any>
    sending: any
    publishing: any
    stream: Readable
    streamValues: any[]
    streamEnded: boolean
    streams: Record<number, Readable>
    streamsValues: Record<number, any[]>
    streamsEnded: Record<number, boolean>
    generatorDestroyed: boolean

    connect(user?: string, password?: string): Promise<void>
    assert(user?: string, password?: string): Promise<void>
    disconnect(): Promise<void>
  }

}
