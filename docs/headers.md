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
| `x-comq-attempt` | a retried message | Which attempt this delivery is, counting from one. Absent on the first, so read it as `headers?.['x-comq-attempt'] ?? 1`. The last attempt is one more than the number of rungs in the [backoff ladder](../readme.md#retries). |
| `x-comq-exchange` | a retried or parked message | The exchange it was originally published to. |
| `x-comq-key` | a retried or parked message | The routing key it was originally published with. |
| `x-comq-queue` | a parked message | The queue it was consumed from. |
| `x-comq-reason` | a parked message | The `message` of the exception that ended its attempts. |
| `x-comq-cause` | a parked message | The `message` of that exception's `cause`, when it has one — a verdict is usually thrown with the failure that prompted it. |
| `x-comq-at` | a parked message | When it was parked, as `Date.now()`. |

`x-comq-exchange` and `x-comq-key` are recorded on the first failure rather than read at parking
time: a message returning from the retry queue arrives through the default exchange, so by then
its own delivery fields describe that hop rather than where it was published.

AMQP defines no retry counter, so `x-comq-attempt` is comq's own rather than a convention —
implementations that roll their own commonly use `x-retry-count` or `x-retries`, and none of
those are standard either. It is prefixed for the same reason as the rest: an unprefixed name
would be free to collide with the application's own headers, or with another library's.

> Before this, the header was named `x-attempt`. A message already in flight under the old name
> is read as a first delivery and gets a full ladder of attempts rather than the remainder of
> one.

A retried message also carries RabbitMQ's own [`x-death`](https://www.rabbitmq.com/docs/dlx),
whose `x-death[0].count` looks like a second attempt counter. It is not the same number: it
counts the times the message expired out of a retry queue, where `x-comq-attempt` counts the
times it was delivered, so on a parked message with the default four-rung ladder they read `4`
and `5`.

**`x-comq-attempt` is the authoritative one** — it is comq's, and it is what the `attempts`
setting is compared against. `x-death` is the broker's record, useful for its timestamps.
