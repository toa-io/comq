import type { Readable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import * as _diagnostics from './diagnostic'
import * as _encoding from './encoding'
import * as _topology from './topology'
import * as _amqp from './amqp'

declare namespace comq {

  type producer = (message: any) => any | Promise<any>
  type consumer = (message: any, headers?: _amqp.Properties) => void | Promise<void>

  interface ReplyEmitter extends EventEmitter {
    readonly queue: string

    tag?: string
  }

  interface Request {
    buffer: Buffer
    emitter: ReplyEmitter
    properties: _amqp.Properties
    reply: any
  }

  interface IO extends _diagnostics.Diagnosable {
    reply (queue: string, produce: producer): Promise<void>

    request (queue: string, payload: any, encoding?: _encoding.encoding): Promise<any>

    request (queue: string, stream: Readable, encoding?: _encoding.encoding): Promise<Readable>

    fetch (queue: string, payload: any, encoding?: _encoding.encoding): Promise<Readable>

    consume (exchange: string, group: string, consumer: consumer): Promise<void>

    consume (exchange: string, consumer: consumer): Promise<void>

    emit (exchange: string, payload: any, encoding?: _encoding.encoding): Promise<void>

    emit (exchange: string, payload: any, properties?: _amqp.Properties): Promise<void>

    emit (exchange: string, stream: Readable, encoding?: _encoding.encoding): Promise<void>

    emit (exchange: string, stream: Readable, properties?: _amqp.Properties): Promise<void>

    seal (): Promise<void>

    close (): Promise<void>

    diagnose (event: 'open', listener: (index?: number) => void): void

    diagnose (event: 'close', listener: (index?: number) => void): void

    diagnose (event: 'flow', listener: (channel: _topology.type, index?: number) => void): void

    diagnose (event: 'drain', listener: (channel: _topology.type, index?: number) => void): void

    diagnose (event: 'remove', listener: (index?: number) => void): void

    diagnose (event: 'recover', listener: (channel: _topology.type, index?: number) => void): void

    diagnose (event: 'discard', listener: (channel: _topology.type, message: any, index?: number) => void): void
  }
}

export type producer = comq.producer
export type consumer = comq.consumer
export type IO = comq.IO
