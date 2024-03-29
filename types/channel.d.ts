import { Message, Options, Connection } from 'amqplib'
import * as _diagnostics from './diagnostic'

declare namespace comq {

  namespace channels {

    type Consumer = (message: Message) => void | Promise<void>

  }

  interface Channel {
    index?: number
    sharded?: boolean

    create (): Promise<void>

    consume (queue: string, consumer: channels.Consumer): Promise<string>

    subscribe (exchange: string, queue: string, consumer: channels.Consumer): Promise<void>

    send (queue: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    publish (exchange: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    fire (queue: string, buffer: Buffer, options?: Options.Publish): Promise<boolean>

    seal (): Promise<void>

    diagnose (event: _diagnostics.Event, listener: Function): void

    forget (event: _diagnostics.Event, listener: Function): void

    recover (connection: Connection): Promise<void>
  }

}

export type Channel = comq.Channel
export type Consumer = comq.channels.Consumer
