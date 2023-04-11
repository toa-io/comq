# Message Properties

Events may be emitted and consumed with custom properties using an optional `properties` argument.

## Emission

`async IO.emit(exchange: string, payload: any, [properties: comq.amqp.options.Publish]): void`

`properties` are passed
to [amqplib.publish](https://amqp-node.github.io/amqplib/channel_api.html#channel_publish).

## Consumption

`async IO.consume(exchange: string, [group: string], consumer): void`

`consumer` function's signature
is `async? (payload: any, [properties: comq.amqp.options.Consume]): void`
