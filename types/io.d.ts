import type { Readable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import * as _diagnostics from './diagnostic'
import * as _encoding from './encoding'
import * as _topology from './topology'
import * as _amqp from './amqp'

declare namespace comq {

  type Producer<Input = any, Output = any> = (message: Input) => Output | Promise<Output>
  type Consumer<T = any> = (message: T, headers?: _amqp.Properties) => void | Promise<void>

  type ReplyHandler = (payload: any, properties: _amqp.Properties, size?: number) => void

  interface ReplyEmitter {
    readonly queue: string

    /** A correlation identifier unique across every consumer of a producer. */
    next(): string

    on(correlationId: string, handler: ReplyHandler): void

    off(correlationId: string, handler?: ReplyHandler): void

    emit(correlationId: string, payload: any, properties: _amqp.Properties, size?: number): boolean

    readonly pending: number
  }

  interface Destroyable extends EventEmitter {
    destroy(): void
  }

  interface Request {
    emitter: ReplyEmitter
    properties: _amqp.Properties
    signal?: AbortSignal
  }

  /** How long a caller waits for a Reply. */
  interface RequestOptions {
    encoding?: _encoding.Encoding

    /**
     * Milliseconds to wait for the Reply. A Request nobody has taken by then is dropped by the
     * broker; one already taken may still be processed, and its Reply is discarded.
     */
    timeout?: number

    /**
     * Ends the wait when aborted, within the timeout. The Request stays in its queue until the
     * timeout passes, or, without one, until a Producer takes it.
     */
    signal?: AbortSignal
  }

  /** The options of a Request, settled once for all its attempts. */
  interface Terms {
    encoding?: _encoding.Encoding
    expires?: number
    signal?: AbortSignal
  }

  interface IO extends _diagnostics.Diagnosable {
    reply(queue: string, produce: Producer): Promise<void>

    request<Reply = any, Request = any>(queue: string, payload: Request, options?: _encoding.Encoding | RequestOptions): Promise<Reply> | Promise<Readable>

    request(queue: string, stream: Readable, options?: _encoding.Encoding | RequestOptions): Promise<Readable>

    /**
     * Sends a Request to whoever holds `key` on the routed `exchange`, through `back`. One that
     * nobody holds is refused with `Unroutable`.
     */
    call<Reply = any, Request = any>(exchange: string, key: string, payload: Request, options?: _encoding.Encoding | RequestOptions): Promise<Reply> | Promise<Readable>

    /**
     * Answers the Requests `call` sends under `key`, from a queue this connection alone holds.
     * Rejects while another connection holds it.
     */
    back(exchange: string, key: string, produce: Producer): Promise<void>

    consume<T = any>(exchange: string, group: string, consumer: Consumer<T>): Promise<void>

    consume<T = any>(exchange: string, consumer: Consumer<T>): Promise<void>

    emit(exchange: string, payload: any, encoding?: _encoding.Encoding): Promise<void>

    emit(exchange: string, payload: any, properties?: _amqp.Properties): Promise<void>

    emit(exchange: string, stream: Readable, encoding?: _encoding.Encoding): Promise<void>

    emit(exchange: string, stream: Readable, properties?: _amqp.Properties): Promise<void>

    enqueue(exchange: string, payload: any, encoding?: _encoding.Encoding): Promise<void>

    enqueue(exchange: string, payload: any, properties?: _amqp.Properties): Promise<void>

    enqueue(exchange: string, stream: Readable, encoding?: _encoding.Encoding): Promise<void>

    enqueue(exchange: string, stream: Readable, properties?: _amqp.Properties): Promise<void>

    /**
     * Publishes to a routed (`direct`) exchange under a key, where `emit` fans out: the
     * message reaches the queues bound under that key and no others.
     */
    route(exchange: string, key: string, payload: any, encoding?: _encoding.Encoding): Promise<void>

    route(exchange: string, key: string, payload: any, properties?: _amqp.Properties): Promise<void>

    /**
     * Consumes a named durable queue bound to a routed exchange under a key, where `consume`
     * takes everything published to a fanout.
     */
    subscribe<T = any>(exchange: string, queue: string, key: string, consumer: Consumer<T>): Promise<void>

    process<T = any>(queue: string, processor: Consumer<T>): Promise<void>

    seal(): Promise<void>

    close(): Promise<void>

    diagnose(event: 'open', listener: (index?: number) => void): void

    diagnose(event: 'close', listener: (error?: Error, index?: number) => void): void

    diagnose(event: 'error', listener: (error: Error, index?: number) => void): void

    diagnose(event: 'reconnect', listener: (index?: number) => void): void

    diagnose(event: 'exhausted', listener: (limit?: number, index?: number) => void): void

    diagnose(event: 'flow', listener: (channel: _topology.type, index?: number) => void): void

    diagnose(event: 'drain', listener: (channel: _topology.type, index?: number) => void): void

    diagnose(event: 'remove', listener: (index?: number) => void): void

    diagnose(event: 'lost', listener: (channel: _topology.type, index?: number) => void): void

    diagnose(event: 'recover', listener: (channel: _topology.type, index?: number) => void): void

    diagnose(event: 'discard', listener: (channel: _topology.type, message: any, error: Error, index?: number) => void): void

    diagnose(event: 'retry', listener: (channel: _topology.type, message: any, error: Error, attempt: number, index?: number) => void): void

    diagnose(event: 'pause', listener: (channel: _topology.type) => void): void

    diagnose(event: 'resume', listener: (channel: _topology.type) => void): void
  }
}

export type Producer = comq.Producer
export type Consumer = comq.Consumer
export type IO = comq.IO
