# One reply queue

An `IO` receives every reply on one queue, `comq.reply..<id>`, whatever it sent the request to.

A reply is found by its `correlationId`. `ReplyEmitter.next` builds one from eight random bytes
and a counter, and it is unique across processes — it has to be, because a producer's control
queue sees the requests of every consumer and tells them apart by nothing else. Routing a reply
reads that identifier and nothing else: the queue it arrived on was never consulted.

## What this changes

| | before | after |
|---|---|---|
| reply queues | one per distinct queue or exchange requested | one |
| its name | `<target>..<id>` | `comq.reply..<id>` |
| scales with | how widely the caller fans out | nothing |

Both are exclusive, so both go with the connection. A sharded connection holds one per shard, as
it held one per target per shard before.

## Why the queue per target goes

The count was the caller's to set and the broker's to pay: a connection that requests fifty
queues held fifty queues and fifty consumers for as long as it lived, whether or not it ever
requested them again. Nothing bounded it but how widely the application was decomposed.

The name was the argument for it — a queue named after what is being called says, to somebody
reading the broker, who is waiting on what. It says it of a queue that carries no messages
between requests, and the same thing is on every message that does pass through: `correlationId`
identifies the request, and the reply-side handler knows which one it belongs to.

## What is given up

Reading the broker no longer tells you which operations a connection calls. A reply queue names
its connection instead, and what it is waiting for is in flight rather than on the broker.

## Upgrading

Reply queues are exclusive and are asserted on the first request, so a process on the old
version and one on the new hold different queues and neither declares the other's. Nothing is
redeclared, and a rollout needs no order.

A parked request keeps the `replyTo` it was sent with, so one parked by an old process still
names the queue that process was listening on — which, as before, is gone once that process is.
