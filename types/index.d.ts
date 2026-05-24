import type { Readable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import type * as amqplib from 'amqplib'

export type Encoding =
  | 'application/msgpack'
  | 'application/json'
  | 'application/octet-stream'
  | 'text/plain'

export type Producer<Input = any, Output = any> = (message: Input) => Output | Promise<Output>
export type Consumer<T = any> = (message: T, headers?: Partial<amqplib.MessageProperties>) => void | Promise<void>

export interface ReplyEmitter extends EventEmitter {
  readonly queue: string
}

export interface Destroyable extends EventEmitter {
  destroy (): void
}

export interface Request {
  buffer: Buffer
  emitter: ReplyEmitter
  properties: Partial<amqplib.MessageProperties>
}

export type DiagnosticEvent =
  | 'open'
  | 'close'
  | 'flow'
  | 'drain'
  | 'remove'
  | 'recover'
  | 'discard'
  | 'pause'
  | 'resume'
  | 'return'

export type TopologyType = 'request' | 'reply' | 'event'

export interface Topology {
  prefetch: number
  confirms: boolean
  durable: boolean
  acknowledgments: boolean
  persistent: boolean
}

export interface IO {
  reply (queue: string, produce: Producer): Promise<void>

  request<Reply = any, RequestPayload = any> (
    queue: string,
    payload: RequestPayload,
    encoding?: Encoding
  ): Promise<Reply>

  request (
    queue: string,
    stream: Readable,
    encoding?: Encoding
  ): Promise<Readable>

  consume<T = any> (exchange: string, group: string, consumer: Consumer<T>): Promise<void>
  consume<T = any> (exchange: string, consumer: Consumer<T>): Promise<void>

  emit (exchange: string, payload: any, encoding?: Encoding): Promise<void>
  emit (exchange: string, payload: any, properties?: Partial<amqplib.MessageProperties>): Promise<void>
  emit (exchange: string, stream: Readable, encoding?: Encoding): Promise<void>
  emit (exchange: string, stream: Readable, properties?: Partial<amqplib.MessageProperties>): Promise<void>

  enqueue (exchange: string, payload: any, encoding?: Encoding): Promise<void>
  enqueue (exchange: string, payload: any, properties?: Partial<amqplib.MessageProperties>): Promise<void>
  enqueue (exchange: string, stream: Readable, encoding?: Encoding): Promise<void>
  enqueue (exchange: string, stream: Readable, properties?: Partial<amqplib.MessageProperties>): Promise<void>

  process<T = any> (queue: string, processor: Consumer<T>): Promise<void>

  seal (): Promise<void>
  close (): Promise<void>

  diagnose (event: 'open', listener: (index?: number) => void): void
  diagnose (event: 'close', listener: (index?: number) => void): void
  diagnose (event: 'flow', listener: (channel: TopologyType, index?: number) => void): void
  diagnose (event: 'drain', listener: (channel: TopologyType, index?: number) => void): void
  diagnose (event: 'remove', listener: (index?: number) => void): void
  diagnose (event: 'recover', listener: (channel: TopologyType, index?: number) => void): void
  diagnose (event: 'discard', listener: (channel: TopologyType, message: any, index?: number) => void): void
  diagnose (event: 'pause', listener: (channel: TopologyType) => void): void
  diagnose (event: 'resume', listener: (channel: TopologyType) => void): void
}

export type Connect = (...urls: string[]) => Promise<IO>

export const connect: Connect
export const assert: Connect
