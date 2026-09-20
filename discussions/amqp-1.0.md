# AMQP 1.0

**comq stays on AMQP 0-9-1 over [amqplib](https://github.com/amqp-node/amqplib).**

RabbitMQ 4 speaks AMQP 1.0 natively and keeps 0-9-1 as a first-class protocol; both are
supported out of the box and neither is on its way out. The choice is therefore comq's to make on
what each protocol and each client gives it, and the answer today is that 1.0 costs a rewrite of
the transport layer, changes comq's public API, breaks the wire between comq versions, and
returns nothing comq uses.

Two separate questions hide in "switch to the official client", and they have different answers.
The client is unusable for comq today. The protocol is usable and in places cleaner, and still
does not pay for itself.

Measured on 2026-09-20 against RabbitMQ 4.3.6, with `rabbitmq-amqp-js-client` 1.0.0, `rhea` 3.0.5
and `amqplib` 2.0.1.

## The client

[`rabbitmq-amqp-js-client`](https://github.com/coders51/rabbitmq-amqp-js-client) is listed among
RabbitMQ's AMQP 1.0 client libraries and is maintained by coders51 rather than by the RabbitMQ
team, unlike the Java, .NET, Go and Python clients. It is a thin wrapper over
[rhea](https://github.com/amqp/rhea), which does the protocol.

What it offers an application is a connection, a publisher, a consumer and a management link.
What comq needs from a client, it does not reach:

| comq | the client |
|---|---|
| 16 [diagnostic events](../readme.md#diagnostics) | connection, publisher and consumer state changes are unobservable ([#40](https://github.com/coders51/rabbitmq-amqp-js-client/issues/40)) |
| [`seal`](../readme.md#sealing) stops consuming and waits | `Consumer.close` is synchronous and returns nothing ([#34](https://github.com/coders51/rabbitmq-amqp-js-client/issues/34)) |
| topology recovered after a reconnect | the links come back, the topology does not ([#42](https://github.com/coders51/rabbitmq-amqp-js-client/issues/42)) |
| prefetch 300, per channel | rhea's default credit window of 1000, fixed |
| Requests and Replies are published unconfirmed | `publish` always awaits settlement |
| `amqp://user:pass@host/vhost`, heartbeat 15s | host, port, username, password |

Three defects it has today would each stop comq on its own:

- **A publish to a queue that does not exist never settles.** The broker refuses the attach with
  `amqp:not-found`; `createPublisher` resolves regardless, and the `publish` promise stays
  pending forever.
- **Attaching to another connection's exclusive queue kills the process.** `createConsumer`
  resolves, the broker ends the session, and rhea emits an unhandled `error` on a container the
  client keeps private. That is exactly what [`back`](../readme.md#addressed-requests) does on
  every key already held.
- **Every body goes out as an `amqp-value` section**, Buffers included, so a 0-9-1 consumer
  receives the section bytes in front of the payload and `type: 'amqp-1.0'` among the properties.
  A process on 0-9-1 and a process on the client cannot exchange a message, which rules out a
  rolling migration. rhea with an explicit `data_section` interoperates cleanly, so this is the
  client's message model rather than the protocol.

Queue `arguments` are typed `Record<string, string>` while the broker requires integers for
`x-message-ttl` (`expected integer, got longstr`) and accepts the numbers the typing forbids. The
dependency on rhea is `github:amqp/rhea` — a git reference that resolves to `git+ssh` in a
lockfile and builds on install, which would land in comq's dependency tree and in every CI that
installs comq.

Adopted with those gaps filled locally, "the official client" becomes "rhea, plus a management
link we wrote" — which is the layer comq already is, over a client with fifteen years behind it.

## The protocol

Everything comq does is expressible over AMQP 1.0, and three mechanisms fit it better than 0-9-1
does:

- **An unroutable publish comes back as a `RELEASED` outcome on the send itself**, where 0-9-1
  reports it asynchronously through `mandatory` and `basic.return` and comq has to correlate it.
- **The `ttl` header is honoured per message**, so a [`call`](../readme.md#timeout)'s expiration
  carries unchanged.
- **Credit is granted per link**, which is what comq's [channel segregation](../readme.md#channels)
  approximates with a prefetch count per channel.

The rest holds: an exclusive queue declared over the management link is refused to a second
connection (`400 cannot obtain exclusive access`), so `back` still holds a Key; numeric queue
arguments are accepted, so the [retry ladder](../readme.md#retries) and `comq.parked` are
unchanged. Streams with offsets and server-side filters are the one capability 0-9-1 cannot match,
and comq consumes no streams.

### What it costs

**comq's public API is shaped by 0-9-1.** `Properties` is in the consumer signature, `emit`,
`enqueue` and `route` take publish options, and `discard`, `retry` and `return` hand listeners a
raw amqplib message. Every one of those changes, and so does what reads them — `@toa.io/bindings.amqp`
reads `message.properties.correlationId` and `properties.headers`.

**Message properties land elsewhere.** A 0-9-1 header prefixed `x-` arrives over 1.0 as a message
annotation rather than an application property, beside the broker's own `x-exchange` and
`x-routing-key`; `replyTo: 'rq'` arrives as `/queues/rq`. comq's [`x-comq-*` headers](../docs/headers.md)
move with them.

**The management UI and API stop reporting message rates** for AMQP 1.0 connections; queue depth
survives, `message_stats` is null. Frame-intercepting plugins and transactions are 0-9-1 only,
and comq uses neither.

**The work is the transport layer and the unit suite.** `source/connection.js` and
`source/channel.js` are 1,256 lines written against amqplib's channel API, `source/io.js` another
797 that speak its vocabulary, and `test/` is built on `test/amqplib.mock.js` — some 6,400 lines
that go with the thing they mock. The 88 scenarios in `features/` are behaviour-level and would
carry over, which makes them the whole safety net for the change.

### What it does not buy

Throughput is level and the latency comq optimises for is worse. Same broker over loopback,
20,000 messages of ~180 bytes, three runs, `TCP_NODELAY` on both:

| | amqplib | rhea |
|---|---|---|
| publish, awaiting confirmation or settlement | 77–88k msg/s | 79–103k msg/s |
| consume and acknowledge | 121–143k msg/s | 110–128k msg/s |

Sequential request and reply, 2,000 round trips, one in flight:

| | p50 | p99 |
|---|---|---|
| amqplib | 0.20 ms | 0.36–0.41 ms |
| rhea | 0.26–0.29 ms | 0.51–0.57 ms |

rhea enables `TCP_NODELAY` when a receiver is attached and leaves it to the `tcp_no_delay` option
otherwise, so a connection that only publishes is left to Nagle — the same delay comq took out of
amqplib in 0.20.1, and worth 22 ms per round trip when it is missed.

## What would reverse this

- comq needs RabbitMQ streams with server-side filtering.
- The client exposes connection and link state, a consumer close that waits, a credit setting and
  a vhost — the four things its own issues already name.
- RabbitMQ announces an end for AMQP 0-9-1.
