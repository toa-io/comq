import * as _diagnostics from './diagnostic'
import * as _encoding from './encoding'
import * as _topology from './topology';

declare namespace comq {

  type producer = (message: any) => any | Promise<any>
  type consumer = (message: any) => void | Promise<void>

  interface ReplyEmitter {
    queue: string

    once(name: string, callback: Function): void

    emit(name: string, value: any): void

    clear(): void
  }

  type ReplyToPropertyFormatter = (queue: string) => string

  interface IO extends _diagnostics.Diagnosable {
    reply(queue: string, produce: producer): Promise<void>

    request(
      queue: string,
      payload: any,
      encoding?: _encoding.encoding,
      replyToFormatter?: ReplyToPropertyFormatter)
      : Promise<any>

    consume(exchange: string, group: string, consumer: consumer): Promise<void>

    consume(exchange: string, consumer: consumer): Promise<void>

    emit(exchange: string, payload: any, encoding?: _encoding.encoding): Promise<void>

    seal(): Promise<void>

    close(): Promise<void>

    diagnose(event: 'open', listener: (index?: number) => void)

    diagnose(event: 'close', listener: (index?: number) => void)

    diagnose(event: 'flow', listener: (channel: _topology.type, index?: number) => void)

    diagnose(event: 'drain', listener: (channel: _topology.type, index?: number) => void)

    diagnose(event: 'remove', listener: (index?: number) => void)

    diagnose(event: 'recover', listener: (channel: _topology.type, index?: number) => void)

    diagnose(event: 'discard', listener: (channel: _topology.type, message: any, index?: number) => void)
  }
}

export type producer = comq.producer
export type consumer = comq.consumer
export type IO = comq.IO
