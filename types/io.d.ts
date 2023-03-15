import * as _diagnostics from './diagnostic'
import * as _encoding from './encoding'

declare namespace comq {

  type producer = (message: any) => Promise<any>
  type consumer = (message: any) => Promise<void>

  interface ReplyEmitter {
    queue: string

    once(name: string, callback: Function): void

    emit(name: string, value: any): void

    clear(): void
  }

  interface IO {
    reply(queue: string, produce: producer): Promise<void>

    request(queue: string, payload: any, encoding?: _encoding.encoding): Promise<any>

    consume(exchange: string, group: string, consumer: consumer): Promise<void>

    emit(exchange: string, payload: any, encoding?: _encoding.encoding): Promise<void>

    seal(): Promise<void>

    close(): Promise<void>

    diagnose(event: _diagnostics.event, listener: Function): void
  }

}

export type producer = comq.producer
export type consumer = comq.consumer
export type IO = comq.IO
