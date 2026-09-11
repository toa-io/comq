# ComQ

Production-grade communication via [AMQP](https://github.com/amqp-node/amqplib)
for distributed, eventually consistent systems running on Node.js.

## Features

- [Dynamic topology](#topology)
- [Request](#request)-[reply](#reply) (RPC), with a [timeout](#timeout)
- [Addressed requests](#addressed-requests) to the one connection holding a Key
- Events ([pub](#emission)/[sub](#consumption)), fanned out or [routed](#routing)
- [Tasks](#tasks)
- [Pipelines](#pipelines)
- [Reply streams](#reply-streams)
- [Content encoding](#encoding)
- [Flow control](#flow-control) and back pressure handling
- [Consumer acknowledgments](#messages) and [publisher confirms](#channels)
- [Poison message handling](#messages)
- [Connection tolerance](#connection-tolerance) and broker restart resilience
- [Sharded connection](#sharded-connection) :rocket:
- [Singleton connection](#singleton-connection)
- [Graceful shutdown](#graceful-shutdown)

> CommonJS, ECMAScript, and TypeScript compatible (types included).

## TL;DR

- [Code examples](examples)
- [Scenarios](features)

## Installation

`npm i comq`

## Connect

`async connect(url: string): IO`

Returns an instance of [`IO`](types/io.d.ts) once a successful connection to the broker is
established.

`url` is passed
to [`amqplib.connect`](https://amqp-node.github.io/amqplib/channel_api.html#connect).

### Example

```javascript
import { connect } from 'comq'

const url = 'amqp://developer:secret@localhost'
const io = await connect(url)

// ...

await io.close()
```

## Definitions

The following documentation refers to a few terms:

**Request** is an AMQP message that is sent to a queue and has the `replyTo` and `correlationId`
properties set.

**Reply** is an AMQP message sent in response to a Request and sent to the queue specified in
the `replyTo` property of the Request. The `correlationId` property of the Reply is set to the same
value as in the Request.

**Event** is an AMQP message published to an exchange.

**Key** is the routing key an Event is published with, and the one a queue is bound under. An
Event published to a fanout exchange carries none.

**Task** is an AMQP message sent to a queue without a `replyTo` property set.

**Producer** is an application role that receives Requests and Tasks, and produces Replies and Events.

**Consumer** is an application role that sends Requests and Tasks, and consumes Replies and Events.

## Reply

`async IO.reply(queue: string, producer): void`

`producer` function's signature is `async? (message: any): any`

Assert a `queue` and start consuming Requests. Received messages are decoded and the resulting
content is passed to the `producer`. The result returned by the `producer` is then encoded and sent
back to the queue specified in the `replyTo` property of the Request, along with a `correlationId`
that has the same value as in the Request.

The Reply message is encoded using the same encoding format as the Request message, unless the
`producer` function returns a `Buffer`. In that case, the encoding format will be set to
`application/octet-stream`. If the encoding format of the Request message is set to
`application/octet-stream` and the `producer` function returns something other than a `Buffer`, an
exception will be thrown.

> The `replyTo` queue is not asserted, as it is expected to be done by the Consumer.

> If the incoming message does not have a `replyTo` property, the result of the `producer` is
> ignored.

### Example

```javascript
await io.reply('add_numbers', ({ a, b }) => (a + b))
```

## Request

`async IO.request(queue: string, payload: any, options?: string | RequestOptions): any`

Send encoded Request message with `replyTo` and `correlationId` properties set and
return decoded Reply content. The promise stays pending until the Reply arrives, or until the
[timeout](#timeout) passes.

On the initial call, queues for Requests and Replies are asserted.

`options` is the encoding, or an object:

| Option     | Type          | Default            |
|------------|---------------|--------------------|
| `encoding` | `string`      | `application/json` |
| `timeout`  | `number`, ms  | none               |
| `signal`   | `AbortSignal` | none               |

### Example

```javascript
const sum = await io.request('add_numbers', { a: 1, b: 2 })
```

### Timeout

A Request with a `timeout` rejects once it passes, with the `TimeoutError` of
[`AbortSignal.timeout`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static).
It is published with that much
[expiration](https://www.rabbitmq.com/docs/ttl#per-message-ttl-in-publishers), so a Request no
Producer has taken by then is dropped by the broker and never processed. A Request a Producer has
already taken is processed to the end, and its Reply is discarded. A Request re-sent after a lost
connection carries the time it has left.

A `signal` rejects the Request with its reason once aborted, within the `timeout` where both are
given. It ends the wait and leaves the Request where it is: in its queue until the `timeout`
passes, or, without a `timeout`, until a Producer takes it. A Request abandoned by its `signal` may
therefore still be processed.

A Request that failed and waits for its [next attempt](#retries) loses its expiration on the way
back to its queue, so it may be processed after its caller has stopped waiting.

```javascript
const sum = await io.request('add_numbers', { a: 1, b: 2 }, { timeout: 5000 })
```

## Consumption

`async IO.consume(exchange: string, group?: string, consumer): void`

`consumer` function's signature is `async? (payload: any): void`

Start consuming decoded Events.

Asserts fanout `exchange` (once per unique `exchange`) and the queue for the Consumer `group` (once
per unique `exchange` and `group` pair), and then binds the queue to the exchange. That is, one
Event message is delivered to a single Consumer within *each group*.

> Typically, the value of `group` refers to the name of a microservice running in multiple
> instances.

If the `group` is `undefined` or omitted, a queue for the Consumer is asserted as exclusive with
auto-generated name.

### Example

```javascript
// with a consumer function
await io.consume('numbers_added', 'logger',
  ({ a, b }) => console.log(`${a} was added to ${b}`))
```

## Emission

`async IO.emit(exchange: string, payload: any, encoding?: string): void`

Publish encoded Event to the `exchange`.

On the initial call,
a [fanout exchange](https://www.rabbitmq.com/tutorials/amqp-concepts.html#exchanges) is
asserted.

### Example

```javascript
await io.emit('numbers_added', { a: 1, b: 2 })
```

## Routing

`async IO.route(exchange: string, key: string, payload: any, encoding?: string): void`

`async IO.subscribe(exchange: string, queue: string, key: string, consumer): void`

Publish and consume Events addressed by a Key, where [Emission](#emission)
and [Consumption](#consumption) fan out.

`route` asserts a
[direct exchange](https://www.rabbitmq.com/tutorials/amqp-concepts.html#exchange-direct) (once per
unique `exchange`) and publishes the encoded Event to it under the `key`. `subscribe` asserts the
same exchange and a durable `queue`, binds it under the `key` (once per unique `exchange`, `queue`
and `key`), and starts consuming. **An Event reaches the queues bound under the Key it carries,
and no others.**

The queue is named rather than derived from a Consumer group, because what identifies it here is
the Key it is bound under rather than the exchange it belongs to. It is also durable, so what is
published while nothing is consuming is held rather than dropped.

Over a [sharded connection](#sharded-connection) they behave as the rest does: `route` publishes
to one shard, and `subscribe` consumes the queue on every one of them.

### Example

```javascript
await io.subscribe('records', 'records.orders', 'store.orders',
  (record) => console.log(record))

await io.route('records', 'store.orders', { id: 1, status: 'paid' })
await io.route('records', 'store.customers', { id: 2 }) // not delivered to the above
```

## Addressed Requests

`async IO.back(exchange: string, key: string, producer): void`

`async IO.call(exchange: string, key: string, payload: any, options?: string | RequestOptions): any`

A Request to the one connection holding a Key, where a [Request](#request) goes to whichever
Producer takes it first.

`back` asserts a [direct exchange](#routing) and a queue named `<exchange>.<key>`, *exclusive* to
the connection, binds it under the `key` and starts consuming Requests, as [`reply`](#reply) does.
**On each broker, one connection holds a Key at a time.** While another connection holds it,
`back` claims it again and again, with the backoff a lost connection is
[restored](#connection-tolerance) with, and emits [`taken`](#diagnostics) on every refusal. The Key
is let go when its connection closes, however it closes — once the broker has noticed, for a
connection that went without a word. `back` returns once a broker holds the Key. The rest of the
connection works throughout, and a connection that is restored claims its Keys again the same way.

`call` publishes the encoded Request to the exchange under the `key` and returns the decoded Reply,
taking the same options as [`request`](#request).

A call ends in one of three ways:

- **A Reply.**
- **Refused at once**, rejecting with `Unroutable`, when no connection holds the Key: it never did,
  its holder has closed, or its holder is [sealed](#sealing). A refused call reached no one.
- **At its [timeout](#timeout)**, when its holder has gone without being sealed — a crashed process,
  a lost connection — or takes longer. A call nobody has taken by then is dropped.

A call waits for as long as it takes unless it has a timeout, and a holder that is gone never
answers it. **Give every call a timeout.**

Sealing withdraws every Key before it stops consuming: a call published from then on is refused,
and one published before it is delivered and answered. Calls queued beyond the
[prefetch](#channels) at that moment go with the connection and end at their timeout.

A Key is as alive as its connection: while the holder reconnects, calls to it are refused, and
calls queued for it are lost.

Over a [sharded connection](#sharded-connection), `back` claims the Key on every shard and returns
once one of them holds it; a shard where it is taken goes on claiming it. Two connections given the
same Key can therefore hold it on different shards and both answer calls, and `taken` is what says
so. A call returned by one shard is published on the next, and refused once every shard has
returned it.

### Example

```javascript
const { Unroutable } = require('comq')

await io.back('sessions', 'a1', (message) => sessions.get(message.id))

try {
  const session = await io.call('sessions', 'a1', { id: 7 }, { timeout: 5000 })
} catch (error) {
  if (error instanceof Unroutable) console.log('Nobody holds', error.key)
}
```

## Tasks

`async IO.enqueue(queue: string, payload: any, encoding?: string): void`

Publish encoded Task to the `queue`.

On the initial call, the `queue` is asserted on the Events channel using [Event topology](#topology).

`async IO.process(queue: string, processor): void`

`processor` function's signature is `async? (payload: any): void`

Process decoded Task from the `queue`.

The `queue` is asserted on the Events channel using Event topology.

## Pipelines

Payloads for Requests, Events and Tasks can be passed as a readable stream
in [object mode](https://nodejs.org/api/stream.html#object-mode), enabling the handling of large amounts of data with
the benefits of RabbitMQ back pressure and flow control.

`async IO.request(queue: string, stream: Readable, encoding?: string): Readable`

Returns a readable stream of replies.

`async IO.emit(exchange: string, stream: Readable, encoding?: string): void`

`async IO.enqueue(queue: string, stream: Readable, encoding?: string): void`

```javascript
function * generate () {
  yield { a: 1, b: 2 };
  yield { a: 3, b: 4 };
}

const events = Readable.from(generate())

await io.emit('numbers_added', events)

const tasks = Readable.from(generate())

await io.enqueue('add_numbers', tasks)

const requests = Readable.from(generate())

for await (const reply of io.request('add_numbers', requests))
  console.log(reply)
```

## Reply streams

The `producer` function of [`IO.reply`](#reply) may return a non-array
(Async)[Iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols).
In this case, the yielded values will be sent to the `replyTo` queue until the iterator is finished,
or a [cancellation message](#stream-control) is received, or the `replyTo` queue is deleted.

```javascript
await io.reply('get_numbers', function * ({ amount }) {
  for (let i = 0; i < amount; i++) yield i
})
```

The Reply stream may be consumed by using the `IO.request` function:

```javascript
const stream = await io.request('get_numbers', { amount: 10 })

for await (const number of stream)
  console.log(number)
```

### Stream topology

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/reply-stream-topology-dark.jpg">
  <img alt="Reply topology" width="500" height="411" src="./docs/reply-stream-topology-light.jpg">
</picture>

When the producer function of `IO.reply` returns an Iterator for the first time across all request queues,
a control queue is asserted on the [Reply channel](#channels)
using the [reply topology](#exchanges-and-queues).
When the Consumer destroys the Reply stream, a stream cancellation message is sent to the Producer's control queue.

### Stream control

Upon receiving a request, the Producer sends a confirmation message to the `replyTo` queue.
If the underlying connection is lost before the Consumer receives the confirmation message,
the request will be retransmitted upon reconnection.

A heartbeat message is sent to the `replyTo` queue whenever a Reply stream idles for 5 seconds.
If the Consumer of the reply stream doesn't receive a reply or a heartbeat message for 12 seconds, the stream returned
by `IO.request` is destroyed.
These intervals are not configurable.

An "end stream" message is sent to the `replyTo` queue when the Reply stream is finished.

When the Consumer falls behind, a "pause" message is sent to the Producer's control queue,
and the Producer stops pulling values from the iterator until a "resume" message follows.
The Producer announces its support of these messages in the confirmation message,
so they are never sent to a Producer that would not understand them.

See also [Reply stream shutdown](#reply-stream-shutdown).

### Loss of tail

:warning:

While consuming the Reply stream if the broker connection is lost,
or if the Consumer crashes or destroys the stream returned by `IO.request`,
some of the values yielded by the Reply stream may be lost.

To avoid inconsistency, it is strongly recommended to use the Reply stream only with _safe_ Producers, which do not
change the application state.

### Stream guarantees

:warning:

The reply topology guarantees
that the order of yielded values is [preserved](https://www.rabbitmq.com/queues.html#message-ordering).
At the same time, there is no guarantee that the stream will be transmitted to the end.

> When using the [Sharded connection](#sharded-connection), the order of yielded values is maintained through buffering.
> However, there is a scenario in which some of the yielded values may be lost if a broker crashes.
> In this case, the Reply stream will be destroyed once the buffer's maximum size is exceeded
> (1000 values or 16 MiB of encoded messages).
> Also, buffered control messages can result in [stream idling](#stream-control).

## Encoding

By default, outgoing message contents are encoded with JSON and
the `contentType` property is set to `application/json`.
If the encoding format is specified ([request](#request), [emit](#emission)), contents are encoded accordingly.

Exceptions are Buffers, which are sent without encoding and the `contentType` property set
to specified encoding format or `application/octet-stream` by default.

Incoming messages are decoded based on the presence and value of the `contentType` property. If the
property is present, the message is decoded. If the header is missing or its value
is `application/octet-stream`, the message is passed as a raw Buffer object.

If the specified encoding format is not supported, an exception will be thrown.

The following encoding formats are supported:

- `application/json`
- `application/octet-stream`
- `text/plain`

## Flow control

When [back pressure](https://www.rabbitmq.com/flow-control.html) is applied to a channel or the
underlying broker connection is lost, any current and future outgoing messages will be paused.
Corresponding returned promises will remain in a `pending` state until the pressure is removed or
the connection is restored.

## Connection tolerance

When the established connection is lost, it will be automatically restored.
Reconnection attempts will be made indefinitely, with intervals increasing up to 30 seconds.
Unless the URL sets one, a 15 second heartbeat is requested, so that a connection that is gone
without a word, such as after a machine wakes from sleep, is noticed within a minute instead of
being left to whatever the broker suggests.
A connection that stays silent for three heartbeats is destroyed regardless of what the broker and
the operating system have reported, since neither is guaranteed to report anything at all.
Requesting `heartbeat=0` disables both.
If the broker rejects the connection, for example, due to access being denied, an exception will be thrown.
Once reconnected, the topology will be recovered, and any unanswered requests and unconfirmed events will be
retransmitted.

## Sharded connection

*Send to one, receive from all.*

A sharded connection is a mechanism that uses multiple connections simultaneously to achieve load
balancing and mitigate failover scenarios, utilizing a set of broker instances that are **not**
combined into a cluster.

Outgoing messages are sent to a single connection chosen at random from the shard pool. Shards that lose their
underlying connection or experience channel [back pressure](#flow-control) on a corresponding channel are removed from
the pool until the issue is resolved. Pending messages meeting these conditions are immediately routed among the
remaining shards in the pool. If no shards are available, `send` / `publish` / `request` wait until a shard's
connection is re-established.

Incoming messages are consumed from all shards.

`async connect(...shards: string[]): IO`

Returns an instance of `IO` once connections to the shards are established.

### Example

```javascript
const shard0 = 'amqp://developer:secret@localhost:5673'
const shard1 = 'amqp://developer:secret@localhost:5674'

const io = await connect(shard0, shard1)

// ...

await io.close()
```

## Singleton connection

`async assert(url: string): IO`

Similar to [`connect`](#connect), but it utilizes shared underlying connections.

The connection is established once per unique `url` among instances of `IO` created with `assert`,
and it will be closed when the last instance of `IO` using that connection is [disconnected](#disconnection).

[Sharded connections](#sharded-connection) are also supported.

`async assert(...shards: string[]): IO`

## Topology

Topology is designed to deliver maximum performance while ensuring that the **at least once**
guarantee provided by RabbitMQ is maintained.

### Dynamic

Static topology refers to the process of defining the complete topology declaration along with the
code that uses it. While this approach may provide a clear and comprehensive view of the system's
architecture, it can be prone to duplication of effort. Moreover, some topologies are inherently
dynamic, such as those that depend on runtime data like incoming messages, making static topology
impossible or hard to maintain. The tradeoff of potentially encountering runtime topology
declaration exceptions, which are more likely to happen during development, is deemed acceptable.

### Channels

`IO` lazy creates individual channels for Requests, Replies, and Events.

- [Prefetch count](https://www.rabbitmq.com/confirms.html#channel-qos-prefetch) for incoming
  Requests and Events are separated. Each is set to `300` (currently non-configurable).
- Incoming Replies have no prefetch limit.
- Outgoing Events are transmitted
  using [confirmation mechanism](https://www.rabbitmq.com/confirms.html#publisher-confirms).

Channel segregation addresses the potential issue of a prefetch deadlock[^1], which may take place
when using a single channel or channel pool.

[^1]: The maximum number of messages has been consumed while handlers of those messages have sent
requests and are expecting replies.

### Exchanges and queues

- Exchanges and queues for Events, and queues for Requests
  are _durable_.
- An exchange is asserted as _fanout_ for [Emission](#emission)
  and [Consumption](#consumption), and as _direct_ for [Routing](#routing). One name is one or
  the other: asserting it as both is what the broker refuses.
- Queues for Replies are _exclusive_ and _auto deleted_.
- A queue [`back`](#addressed-requests) holds is _exclusive_, bound under its Key to a _direct_
  exchange.

comq declares two kinds of queue of its own, for [failed messages](#retries):

- `comq.retry.<delay>`, with a fanout exchange of the same name, one pair per distinct rung of
  the [backoff ladder](#retries), shared by every queue that uses it.
- `comq.parked.<queue>`, one per consumed queue, declared to live as long as it does.

See [queue assertion options](https://amqp-node.github.io/amqplib/channel_api.html#channel_assertQueue).

### Messages

- Events are
  *persistent* ([delivery mode 2](https://www.rabbitmq.com/publishers.html#message-properties)),
  while Requests and Replies are not (mode 1).
- Events and Requests are consumed using
  manual [acknowledgment mode](https://www.rabbitmq.com/confirms.html#acknowledgment-modes),
  and Replies are consumed using automatic mode.

#### Retries

If an incoming message causes an exception, comq publishes it to a *retry queue* and only then
acknowledges the original. The retry queue has no consumer: it holds the message for
`delay` milliseconds and then returns it to the queue it came from, so the wait is the broker's
and outlives a restart of this process without holding a delivery against the
[prefetch limit](#channels).

Each attempt increments the [`x-comq-attempt`](./docs/headers.md) header, which the consumer
receives among the message properties. `delay` is a backoff ladder with **one rung per retry**,
so its length decides how many there are: the four rungs of the default are five attempts, and
once a message has climbed it there is nowhere left to wait and it is *parked*.

The channel keeps consuming throughout. A message one consumer cannot handle stops neither the
other consumers nor that consumer's next message; only the message that failed is delayed.

`delay` is a [topology](#topology) setting:

| | ladder | attempts | total |
|---|---|---|---|
| Event | 1s, 10s, 30s, 90s | 5 | 131s |
| Request | 1s, 3s, 5s, 10s | 5 | 19s |

Requests are shorter because a caller is blocked on one, and a Reply arriving long after it
stopped waiting has nowhere useful to land. Nobody waits on an Event.

One retry queue and one exchange are declared per distinct wait and shared by every queue that
uses them, so their number grows with the length of the ladder rather than with the number of
queues.

#### Saying how it failed

A consumer can classify its failure, which decides whether the message is worth another
attempt at all:

```javascript
const { Retry, Park } = require('comq')

await io.consume('orders', 'billing', async (order) => {
  if (typeof order.total !== 'number') throw new Park('no total on order')

  try {
    await billing.charge(order)
  } catch (e) {
    throw new Retry('billing unavailable', { cause: e })
  }
})
```

- `Park` says this consumer will never process this message, however many times it is handed
  over. It is [parked](#parked-messages) at once, without climbing the ladder.
- `Retry` says whatever was missing may be back shortly. This is what an unclassified rejection
  already means, so throwing it changes nothing but the reader's certainty.

**A bare rejection means `Retry`** — a failure nobody classified is a failure nobody chose — so
consumers written before this behave exactly as they did.

Both are `Error`s and both take a `cause`, which is recorded on the parked message alongside the
verdict's own message.

> **`Park` is not applicable to a `Producer` given to [`IO.reply`](#reply).** A Request
> has a caller awaiting a reply, so what happens to a failed one is not a policy choice. A `Park`
> thrown there is treated as an ordinary failure — retried, then parked on the count — and the
> parked message says so as its reason.

#### Parked messages

A message that has run out of attempts is published to `comq.parked.<queue>` and acknowledged
only once the broker confirms it. It is not deleted, and it does not depend on a broker-side
policy. The [`discard`](#diagnostics) diagnostic event is emitted when it happens, and
[`retry`](#diagnostics) on every attempt before it.

A parked message carries what a person looking at it needs: `x-comq-exchange` and `x-comq-key`
name where it was originally published, `x-comq-queue` the queue it was consumed from,
`x-comq-reason` the exception's message, and `x-comq-at` when it was parked. Its original
properties are kept as they were.

Parked queues grow until somebody drains them, which is deliberate — the alternative is deleting
evidence. Alert on [`discard`](#diagnostics), and do not delete `comq.retry.*` or `comq.parked.*`
queues on a running system.

> **A parked Request is never answered.** A Consumer awaiting its Reply waits until its
> [timeout](#timeout), or indefinitely without one, and with a limited prefetch that can deadlock
> it. Parking keeps the Request rather than deleting
> it — and it keeps `replyTo` and `correlationId`, so a Reply can still be produced from it by
> hand while the caller is alive — but comq itself sends no Reply and reports no error to the
> caller.

#### What is guaranteed

The copy is published *before* the original is acknowledged, so a process that dies between the
two leaves the broker holding both and the message is handled twice: **consumers must be
idempotent**. That is the deliberate trade — a message the broker holds twice can be recovered,
one it no longer holds at all cannot.

A retried message re-enters its queue behind the messages published while it waited, so
**ordering is not preserved across a failure**.

Retries and parked messages are published *persistent* whatever the channel is, so they survive a
restart of the broker even on the Request channel. Ordinary publishing is untouched: Requests and
Replies stay [delivery mode 1](#messages), and only a message that has already failed is written
to disk.

On the Request channel the copy is published without [publisher confirms](#channels). Those are
an Events property here, because a confirm is a round trip and Requests are where that is felt —
the same reason they are not persistent. Confirm mode belongs to the channel rather than to a
publish, so the failure path cannot ask for it on its own.

What that costs is narrow. Commands on a channel are handled in order, so the broker takes the
copy before it releases the original, and `mandatory` brings back a copy it could not route. What
is left uncovered is a broker that accepted the frame and then failed to keep it.

The return hop of a retry — the broker moving a message out of the retry queue when its wait
expires — is dead-lettering, and on classic queues that is at-most-once: a retry can be lost if
its source queue is unavailable at the moment the delay expires. This applies to every channel,
not only Requests.

See:

- [Consumer Acknowledgments and Publisher Confirms](https://www.rabbitmq.com/confirms.html)
- [Dead Letter Exchanges](https://www.rabbitmq.com/dlx.html)
- [At-Least-Once Dead Lettering](https://www.rabbitmq.com/blog/2022/03/29/at-least-once-dead-lettering)

### Cheatsheet

| Message | Prefetch  | Confirms | Queue     | Acknowledgment | Persistent | Retries          |
|---------|-----------|----------|-----------|----------------|------------|------------------|
| Request | limited   | no       | durable   | manual         | no         | 1s, 3s, 5s, 10s  |
| Reply   | unlimited | no       | exclusive | automatic      | no         | —                |
| Event   | limited   | yes      | durable   | manual         | yes        | 1s, 10s, 30s, 90s |

### Settings

Each channel type has a [preset](./source/topology), and the trailing argument of `connect`
overrides any of its fields:

```javascript
const io = await comq.connect(url, {
  event: { delay: [5000, 60000] },  // two retries
  request: { delay: 1000 }          // one
})
```

`delay` is the one meant to be set. Changing the rest will change what a Request, a Reply and an
Event *are*.

> Changing `delay` declares new retry queues rather than redeclaring the existing ones, so a
> rolling deploy that changes it has no window in which either version fails. The queues left
> behind are empty and can be removed once nothing is publishing to them.

## Graceful shutdown

### Sealing

`async IO.seal(): void`

[Stop receiving](https://amqp-node.github.io/amqplib/channel_api.html#channel_cancel) new Events and
Requests.
Sending Requests, receiving Replies, and emitting Events will still be available.

Keys held by [`back`](#addressed-requests) are withdrawn first, so a call published from then on is
refused.

### Disconnection

`async IO.close(): void`

1. Call `IO.seal()`.
2. Wait for any outstanding messages to be processed[^2] and acknowledged.
3. Close the connection.

[^2]: Therefore, if the underlying connection is lost, `.close()` will only be completed once the
connection is [recovered](#connection-tolerance).

### Advanced Scenarios

`IO.close()` tracks the completion of [`producer`](#reply) and [`consumer`](#consumption) function
calls, by waiting for their returned promises to be settled. However, it is possible for an attempt
to be made to send an outgoing message after the connection has been closed, resulting in the
`Channel ended, no reply will be forthcoming` exception. This may occur *at least* in the following
scenarios:

1. The `producer` or `consumer` function spawns a new asynchronous context that attempts to send an
   outgoing message after the returned promise has been settled.
2. An application has other incoming communication channels, such as an HTTP API, that may lead to
   an attempt to send an outgoing message after `IO.close()` has closed the connection.

In these or other similar scenarios, it is recommended to call `IO.seal()` to stop receiving new
messages, ensure that any code execution that may send outgoing messages is completed before
calling `IO.close()`.

### Reply stream shutdown

All current [Reply streams](#reply-streams) of the corresponding Producer or Consumer instance are destroyed when:

- the `IO.seal` function is called on the Consumer
- the `IO.close` function is called on the Producer

## Diagnostics

`IO` emits events for testing, diagnostics, or logging purposes.

`IO.diagnose(event: string, listener: Function): void`

Subscribe to one of the diagnostic events:

- `open`: connection is opened[^3].
- `close`: connection is closed.
  Optional [`error`](https://amqp-node.github.io/amqplib/channel_api.html#model_events) is passed
  as an argument.
- `error`: an attempt to restore the connection has failed. The exception is passed as an argument.
  Attempts continue until one succeeds.
- `reconnect`: an attempt to restore the connection has started. Followed by `open` or `error`.
- `exhausted`: the connection has no channel left to allocate. The negotiated channel limit is
  passed as an argument. Reconnecting does not free a channel, so the operation that asked for
  one is rejected rather than retried.
- `flow`: back pressure is applied to a channel. [Channel type](./types/topology.d.ts) is passed as
  an argument.
- `drain`: back pressure is removed from a channel. Channel type is passed.
- `remove`: channel is removed from the [pool](#sharded-connection), having failed to publish.
- `lost`: a shard has lost its connection, hence the requests awaiting their replies on it are
  re-sent. Channel type is passed.
- `recover`: channel's topology is recovered. Channel type is passed.
- `discard`: message is [parked](#parked-messages), having run out of attempts. Channel type,
  raw [amqp message object](https://amqp-node.github.io/amqplib/channel_api.html#channel_consume)
  and the exception are passed as arguments.
- `retry`: message caused an exception and has been published to its
  [retry queue](#retries). Channel type, the raw amqp message object, the exception and the
  attempt number are passed as arguments.
- `return`: message is returned by the broker as unroutable. Channel type and the raw
  [amqp message object](https://amqp-node.github.io/amqplib/channel_api.html#channel_publish) are
  passed as arguments. In the case of a [sharded connection](#sharded-connection), the message is
  reported only once every shard has rejected it.
- `taken`: a Key [`back`](#addressed-requests) claims is held by another connection on this broker, and
  is claimed again. Channel type and the queue name are passed.
- `pause`: channel is paused. Channel type is passed.
  In the case of a [sharded connection](#sharded-connection), it means that there is no shard left
  to publish to, be it because every one of them has rejected a publish or lost its connection.
- `resume`: channel is resumed. Channel type is passed.

In the case of a [sharded connection](#sharded-connection), an additional argument specifying the
shard number will be passed to listeners.
This is applicable except for the `pause` and `resume` events,
which are emitted when the associated channels are paused or resumed across all shards.
The shard number corresponds to the position of the argument used in the `connect` function call.

[^3]: As the [`connect`](#connect) function returns an instance of `IO` *after* the connection has been
established, there is no way to capture the initial `open` event.

### Example

```javascript
io.diagnose('flow', (type) => console.log(`Back pressure was applied to the ${type} channel`))

io.diagnose('reconnect', (shard) => console.log('AMQP reconnecting', { shard }))
io.diagnose('exhausted', (limit, shard) => console.log('AMQP channels exhausted', { limit, shard }))
io.diagnose('open', (shard) => console.log('AMQP connection established', { shard }))
io.diagnose('close', (error, shard) => console.log('AMQP connection closed', { message: error?.message, shard }))
io.diagnose('error', (error, shard) => console.log('AMQP connection failed', { message: error.message, shard }))
io.diagnose('lost', (type, shard) => console.log('AMQP shard lost', { type, shard }))
io.diagnose('recover', (type, shard) => console.log('AMQP channel recovered', { type, shard }))
```

# Gratitude

I want to express my deep appreciation to [@mzabolotko](https://github.com/mzabolotko) for his
generous contribution of time and expertise.
