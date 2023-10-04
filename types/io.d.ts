import type { Readable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import * as _diagnostics from './diagnostic'
import * as _encoding from './encoding'
import * as _topology from './topology'
import * as _amqp from './amqp'

declare namespace comq {

  type Producer<Input = any, Output = any> = (message: Input) => Output | Promise<Output>
  type Consumer<T = any> = (message: T, headers?: _amqp.Properties) => void | Promise<void>

  interface ReplyEmitter extends EventEmitter {
    readonly queue: string
  }

  interface Destroyable extends EventEmitter {
    destroy (): void
  }

  interface Request {
    buffer: Buffer
    emitter: ReplyEmitter
    properties: _amqp.Properties
  }

  interface IO extends _diagnostics.Diagnosable {
    reply (queue: string, produce: Producer): Promise<void>

    request<Reply = any, Request = any> (queue: string, payload: Request, encoding?: _encoding.Encoding): Promise<Reply> | Promise<Readable>

    request (queue: string, stream: Readable, encoding?: _encoding.Encoding): Promise<Readable>

    consume<T = any> (exchange: string, group: string, consumer: Consumer<T>): Promise<void>

    consume<T = any> (exchange: string, consumer: Consumer<T>): Promise<void>

    emit (exchange: string, payload: any, encoding?: _encoding.Encoding): Promise<void>

    emit (exchange: string, payload: any, properties?: _amqp.Properties): Promise<void>

    emit (exchange: string, stream: Readable, encoding?: _encoding.Encoding): Promise<void>

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

export type Producer = comq.Producer
export type Consumer = comq.Consumer
export type IO = comq.IO
