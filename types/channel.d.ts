import { Message, Options, Connection } from 'amqplib'
import * as _diagnostics from './diagnostic'

declare namespace comq {

  namespace channels {

    type consumer = (message: Message) => void | Promise<void>

  }

  interface Channel {
    index?: number
    sharded?: boolean

    create (): Promise<void>

    consume (queue: string, consumer: channels.consumer): Promise<string>

    subscribe (exchange: string, queue: string, consumer: channels.consumer): Promise<void>

    send (queue: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    publish (exchange: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    fire (queue: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    cancel (consumerTag: string): Promise<void>

    seal (): Promise<void>

    diagnose (event: _diagnostics.event, listener: Function): void

    recover (connection: Connection): Promise<void>
  }

}

export type Channel = comq.Channel
export type consumer = comq.channels.consumer
