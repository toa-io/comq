# ComQ

Production-grade communication via [AMQP](https://github.com/amqp-node/amqplib)
for distributed, eventually consistent systems running on Node.js.

## Features

- [Dynamic topology](#topology)
- [Request](#request)-[reply](#reply) (RPC)
- Events ([pub](#emission)/[sub](#consumption))
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

**Event** is an AMQP message that is published to an exchange.

**Producer** is an application role that receives Requests and produces Replies and Events.

**Consumer** is an application role that sends Requests and consumes Replies and Events.

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

`async IO.request(queue: string, payload: any, encoding?: string): any`

Send encoded Request message with `replyTo` and `correlationId` properties set and
return decoded Reply content.

On the initial call, queues for Requests and Replies are asserted.

### Example

```javascript
const sum = await io.request('add_numbers', { a: 1, b: 2 })
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

## Pipelines

Payloads for Requests and Events can be passed as a readable stream
in [object mode](https://nodejs.org/api/stream.html#object-mode), enabling the handling of large amounts of data with
the benefits of RabbitMQ back pressure and flow control.

`async IO.request(queue: string, stream: Readable, encoding?: string): Readable`

Returns a readable stream of replies.

`async IO.emit(exchange: string, stream: Readable, encoding?: string): void`

```javascript
function * generate () {
  yield { a: 1, b: 2 };
  yield { a: 3, b: 4 };
}

const events = Readable.from(generate())

await io.emit('numbers_added', events)

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
> In this case, the Reply stream will be destroyed once the buffer's maximum size is exceeded.
> Also, buffered control messages can result in [stream idling](#stream-control).

## Encoding

By default, outgoing message contents are encoded with [msgpack](https://msgpack.org) and
the `contentType` property is set to `application/msgpack`. If the encoding format is
specified ([request](#request), [emit](#emission)), contents are encoded accordingly.

Exceptions are Buffers, which are sent without encoding and the `contentType` property set
to specified encoding format or `application/octet-stream` by default.

Incoming messages are decoded based on the presence and value of the `contentType` property. If the
property is present, the message is decoded. If the header is missing or its value
is `application/octet-stream`, the message is passed as a raw Buffer object.

If the specified encoding format is not supported, an exception will be thrown.

The following encoding formats are supported:

- `application/msgpack`
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
remaining shards in the pool. If no shards are available, messages will wait until a shard's connection is
re-established.

Incoming messages are consumed from all shards.

`async connect(...shards: string[]): IO`

Returns an instance of `IO` once a successful connection to one of the shards is established.

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
- Queues for Replies are _exclusive_ and _auto deleted_.

See [queue assertion options](https://amqp-node.github.io/amqplib/channel_api.html#channel_assertQueue).

### Messages

- Events are
  *persistent* ([delivery mode 2](https://www.rabbitmq.com/publishers.html#message-properties)),
  while Requests and Replies are not (mode 1).
- Events and Requests are consumed using
  manual [acknowledgment mode](https://www.rabbitmq.com/confirms.html#acknowledgment-modes),
  and Replies are consumed using automatic mode.

If an incoming message causes an exception, then it is "negatively acknowledged" and requeued. If it
causes an exception again, it will be discarded.

> It is highly recommended to set up a dead letter exchange policy to analyze messages that caused
> exceptions. Note that in some cases, if the problematic message is a Request, a Consumer will
> never receive a Reply, and this can result in a prefetch deadlock of a Consumer.

See:

- [Consumer Acknowledgments and Publisher Confirms](https://www.rabbitmq.com/confirms.html)
- [Negative Acknowledgment and Requeuing of Deliveries](https://www.rabbitmq.com/confirms.html#consumer-nacks-requeue)
- [Dead Letter Exchanges](https://www.rabbitmq.com/dlx.html)

### Cheatsheet

| Message | Prefetch  | Confirms | Queue     | Acknowledgment | Persistent |
|---------|-----------|----------|-----------|----------------|------------|
| Request | limited   | no       | durable   | manual         | no         |
| Reply   | unlimited | no       | exclusive | automatic      | no         |
| Event   | limited   | yes      | durable   | manual         | yes        |

## Graceful shutdown

### Sealing

`async IO.seal(): void`

[Stop receiving](https://amqp-node.github.io/amqplib/channel_api.html#channel_cancel) new Events and
Requests.
Sending Requests, receiving Replies, and emitting Events will still be available.

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
- `flow`: back pressure is applied to a channel. [Channel type](./types/topology.d.ts) is passed as
  an argument.
- `drain`: back pressure is removed from a channel. Channel type is passed.
- `remove`: channel is removed from the [pool](#sharded-connection).
- `recover`: channel's topology is recovered. Channel type is passed.
- `discard`: message is [discarded](#messages) as it repeatedly caused
  exceptions. Channel type,
  raw [amqp message object](https://amqp-node.github.io/amqplib/channel_api.html#channel_consume)
  and the exception are passed as arguments.
- `pause`: channel is paused. Channel type is passed.
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
```

# Gratitude

I want to express my deep appreciation to [@mzabolotko](https://github.com/mzabolotko) for his
generous contribution of time and expertise.
