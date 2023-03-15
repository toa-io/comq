import * as amqplib from 'amqplib'

declare namespace comq.amqp {

  namespace options {
    type Consume = amqplib.Options.Consume
    type Publish = amqplib.Options.Publish
  }

  type Connection = amqplib.Connection
  type Channel = amqplib.Channel | amqplib.ConfirmChannel

}

export type Connection = comq.amqp.Connection
export type Channel = comq.amqp.Channel
