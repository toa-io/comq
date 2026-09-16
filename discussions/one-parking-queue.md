# One parking queue

> Supersedes the parking queue's naming and lifetime in
> [poison message handling](./poison-message-handling.md), Part 1. Everything else about
> parking — when a message is parked, what it carries, what is published before what — is
> unchanged.

Everything a consumer could not process is kept in one queue, `comq.parked`, whatever it was
consumed from. It is durable, it is declared once per channel beside the retry queues, and comq
never removes it or what is in it.

A parked message already says where it came from. `x-comq-queue` is the queue it was consumed
from, `x-comq-exchange` and `x-comq-key` where it was originally published, and all three are
recorded on the first failure rather than read at parking time. Reading one source's parked
messages is a match on `x-comq-queue`.

## What this changes

| | before | after |
|---|---|---|
| parking queues | one per consumed queue | one |
| its lifetime | the lifetime of the queue it served | durable, always |
| what a groupless subscriber parks | went with its connection | kept |
| scales with | how many queues the connection consumes | nothing |

## Why the queue per source goes

**It was measured.** The cost of this design was worked through when it was made, at 200 source
queues and 200 parking queues, and accepted. In a deployment of about forty processes the
parking queues came to 1318 of 2731 queues on the broker — 48 % — and every one of them was
empty, with no consumer and no message it had ever held. At about 70 KB of broker memory per
queue, that is the largest single item on a broker that had been blocking publishers on a memory
alarm.

The count is what makes it grow: one per consumed queue means the broker pays for how widely an
application is decomposed, forever, whether or not anything ever fails.

**Depth per source survives.** The reason recorded for the queue per source was that depth per
consumer is how anyone notices a problem. What notices a problem is the `discard` diagnostic,
which fires per parked message and names the queue it came from. Depth in `comq.parked` still
says how much is waiting, and `x-comq-queue` still says what for.

**The lifetime rule goes with it.** The parking queue mirrored its source's durability so that a
durable parking queue would not be left behind an exclusive `amq.gen-*` source — one leaked per
restart, forever. With a fixed name there is nothing to leak, and the rule that prevented the
leak was throwing away the evidence it was meant to keep: a groupless subscriber's failures
vanished with its connection, at the moment there was nobody left to tell.

## Upgrading

`comq.parked.<queue>` queues from an earlier version keep whatever they already hold. comq stops
declaring them and stops publishing to them, so they are drained and deleted once, by hand.

Nothing is redeclared with different arguments, so no assertion answers `PRECONDITION_FAILED`
and no broker has to be emptied. During a rollout the processes still on the old version go on
parking per source and the new ones park in `comq.parked`; both are readable, and both say
which queue a message came from.

## What comq says about it

That the queue is there, that a message in it names its source, and that comq removes neither.
What to do with a queue on a broker — a `max-length`, a TTL, an alert on depth — is read off
those facts by whoever can see the broker.
