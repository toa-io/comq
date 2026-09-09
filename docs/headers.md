# Message Properties

Events may be emitted and consumed with custom properties using an optional `properties` argument.

## Emission

`async IO.emit(exchange: string, payload: any, [properties: comq.amqp.Properties]): void`

`properties` are passed
to [amqplib.publish](https://amqp-node.github.io/amqplib/channel_api.html#channel_publish).

## Consumption

`async IO.consume(exchange: string, [group: string], consumer): void`

`consumer` function's signature
is `async? (payload: any, [properties: comq.amqp.Properties]): void`

## Headers set by comq

A message that failed at least once carries headers comq wrote, and a consumer sees them among
the message properties.

| Header | On | Meaning |
|---|---|---|
| `x-attempt` | a retried message | Which attempt this delivery is. Absent on the first. |
| `x-comq-exchange` | a retried or parked message | The exchange it was originally published to. |
| `x-comq-key` | a retried or parked message | The routing key it was originally published with. |
| `x-comq-queue` | a parked message | The queue it was consumed from. |
| `x-comq-reason` | a parked message | The `message` of the exception that ended its attempts. |
| `x-comq-at` | a parked message | When it was parked, as `Date.now()`. |

`x-comq-exchange` and `x-comq-key` are recorded on the first failure rather than read at parking
time: a message returning from the retry queue arrives through the default exchange, so by then
its own delivery fields describe that hop rather than where it was published.

A retried message also carries RabbitMQ's own [`x-death`](https://www.rabbitmq.com/docs/dlx), and
`x-death[0].count` is a second attempt counter that happens to agree with `x-attempt`. **`x-attempt`
is the authoritative one** — it is comq's, and it is the number the `attempts` setting is compared
against. `x-death` is the broker's record, and is useful for its timestamps.
