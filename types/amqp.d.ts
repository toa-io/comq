import * as amqplib from 'amqplib'

declare namespace comq.amqp {

  namespace options {
    type Consume = amqplib.Options.Consume
    type Publish = amqplib.Options.Publish
    type Exchange = amqplib.Options.AssertExchange
    type Queue = amqplib.Options.AssertQueue
  }

  type Connection = amqplib.Connection
  type Channel = amqplib.Channel | amqplib.ConfirmChannel
  type Message = amqplib.Message
  type Properties = Partial<amqplib.MessageProperties>
}

export type Connection = comq.amqp.Connection
export type Channel = comq.amqp.Channel
export type Properties = comq.amqp.Properties
