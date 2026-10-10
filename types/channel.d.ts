import { Message, Options, Connection } from '@toa.io/amqplib'
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

    /** consumes `queue`, bound to a routed `exchange` under `key` */
    bound (exchange: string, queue: string, key: string, consumer: channels.Consumer): Promise<void>

    /** consumes `queue`, exclusive to this connection and bound to a routed `exchange` under `key` */
    held (exchange: string, queue: string, key: string, consumer: channels.Consumer): Promise<void>

    /**
     * Over a sharded connection, `via` is told the index of the shard the message is published
     * through, as soon as it is chosen and again whenever the publish fails over to another.
     */
    send (queue: string, buffer: Buffer, options?: Options.Publish, via?: (index: number) => void): Promise<void>

    publish (exchange: string, buffer: Buffer, options?: Options.Publish): Promise<void>

    /** publishes to a routed exchange under `key`, where `publish` fans out */
    route (exchange: string, key: string, buffer: Buffer, options?: Options.Publish, via?: (index: number) => void): Promise<void>

    /**
     * Over a sharded connection, the message goes back through the shard `origin`, the message it
     * answers, arrived on, while that shard is reachable.
     */
    fire (queue: string, buffer: Buffer, options?: Options.Publish, origin?: Message): Promise<boolean>

    seal (): Promise<void>

    /** resolves once what was delivered and what was published is done with */
    settled? (): Promise<void>

    /** since when there has been nothing to do, which is now while there is */
    quiet? (): Promise<number>

    /** over a sharded connection: whether a shard is one of the channel's */
    has? (index: number): boolean

    /** takes a shard in, consuming from it what is consumed from the rest */
    join? (connection: any, index: number): Promise<void>

    /** stops publishing through a shard, which goes on being consumed from */
    retire? (index: number): void

    restore? (index: number): void

    /** lets a shard go, once what it has delivered is done with */
    leave? (index: number): Promise<void>

    /** told by whoever publishes whether a shard owes it something */
    occupy? (occupied: (index: number) => boolean): void

    close (): Promise<void>

    readonly closed: boolean

    /** `reroute` is a sharded channel's own: a returned message is published on another shard */
    diagnose (event: _diagnostics.Event | 'reroute', listener: Function): void

    forget (event: _diagnostics.Event, listener: Function): void

    recover (connection: Connection): Promise<void>
  }

}

export type Channel = comq.Channel
export type Consumer = comq.channels.Consumer
