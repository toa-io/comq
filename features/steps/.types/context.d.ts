import { Readable } from 'node:stream'
import { Socket } from 'node:net'
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
    consumed: Record<string, { payload: any, properties?: _amqp.Properties }>
    consumedCount: number
    events?: { [K in _diagnostics.Event]?: boolean }
    enqueued?: any
    processed: any
    tasksProcessedCount: number
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
    networks: Network[]

    connect(user?: string, password?: string): Promise<void>
    assert(user?: string, password?: string): Promise<void>
    disconnect(): Promise<void>
    unplug(): Promise<void>
  }

  interface Network {
    readonly address: string

    open(): Promise<void>
    silence(): void
    close(): Promise<void>
  }

  interface Tunnel {
    client: Socket
    upstream: Socket
    silent: boolean
  }

}
