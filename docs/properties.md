# Message Properties

The `IO` methods include an optional `properties` argument that enables sending and receiving
message properties.

Specified `properties` are passed
to [amqplib.publish](https://amqp-node.github.io/amqplib/channel_api.html#channel_publish).

## Reply

`async IO.reply(queue: string, producer): void`

`producer` function's signature
is `async? (message: any, properties: comq.amqp.options.Consume): any`

## Request

`async IO.request(payload: any, [properties: comq.amqp.options.Publish])`

## Consumption

`async IO.consume(exchange: string, [group: string], consumer): void`

`consumer` function's signature
is `async? (payload: any, properties: comq.amqp.options.Consume): void`

## Emission

`async IO.emit(exchange: string, payload: any, [properties: comq.amqp.options.Publish]): void`
