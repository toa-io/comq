# Fix comq's poison-message handling

> **A proposal, open for discussion — nothing here is implemented.** It covers what comq does
> today when a consumer callback rejects, why that is wrong, and what to build instead. Three
> questions are still open, listed at the very end. Comments welcome on any of it,
> especially Part 1, which is the one decision that shapes the rest.

When a consumer callback rejects, comq is supposed to retry the message a few times and then
give up on it. What it actually does is kill the process, and take every other consumer in that
process with it. Six verified defects, all in [source/channel.js](../source/channel.js) — full
detail in **Context** at the end.

One of the six — the last attempt silently deleting the message — needs a mechanism comq does
not have today, and the obvious candidate is not one. That comes first, because everything else
is routine by comparison.

- **Part 1** — where a message goes when comq gives up on it. comq parks it in a queue it owns.
  Includes why RabbitMQ's dead-lettering is *not* the mechanism for this, and the one
  compatibility trap to avoid.
- **Part 2** — the other five defects. No upgrade impact.
- **Part 3** — the proposed `Retry` / `Park` verdict API, and what it does and does not change
  here (short answer: it adds one branch to Part 2, and one naming decision to Part 1).

---

# Part 1 — Where a message goes when comq gives up on it

## The problem

The last failed attempt destroys the message. `#discard` ([:406](../source/channel.js#L406)) is:

```js
this.#channel.nack(message, false, false)
```

`requeue: false` means "the broker may dead-letter this" — but only if the queue was declared
with a dead-letter exchange, and **comq never declares one**. `grep` for `x-dead-letter` or
`arguments:` across `source/` returns nothing; `#assertQueue`
([:246-253](../source/channel.js#L246)) passes only `{ durable: true }` or `{ exclusive: true }`.
So the message is silently deleted. [readme.md:468](../readme.md#L468) tells the reader to
configure a policy on the broker by hand — a library whose documented failure mode is silent
deletion.

## The mechanism: comq parks it in a queue it owns

On the last attempt, comq publishes the message to `comq.dead.<queue>`, waits for the publisher
confirm, and only then acks the original.

**This is about retention, not delivery.** The message is not going to be processed again — that
is settled. What is at stake is whether it is still *there* afterwards. A message that has
exhausted its attempts is evidence that something is wrong: a bad producer, a schema change, a
bug in the consumer. Today comq deletes that evidence. The requirement is that when comq says it
has kept the message, that is true and not merely likely.

Publishing before acking is what makes it true: the broker holds the parked copy before it
releases the original, so there is no window in which it holds neither. If comq dies between the
two, the original is redelivered and parked again — two copies of the same evidence in a queue
nothing consumes, which is harmless. (Consumers do need to be idempotent, but because of the
retry path and redelivery generally, not because of this.)

> ### Two mechanisms, easily confused
>
> | | **Part 2 — retry** | **Part 1 — parking** |
> |---|---|---|
> | when | attempts 1–5 | after the 6th failure |
> | queue | `comq.retry.<queue>` | `comq.dead.<queue>` |
> | how it gets there | comq publishes it | comq publishes it |
> | what happens next | the broker returns it to the source queue after the TTL | nothing — it waits for a human |
> | purpose | try again later | keep the evidence |
>
> Both are new queues comq declares, and **dead-lettering appears in both doing different
> jobs**: in Part 2 it is the routing trick that carries a message *back* to its source when the
> TTL fires; in Part 1 it is the rejected way of moving a message to its final resting place.

## Why RabbitMQ's dead-lettering is not the mechanism

The obvious alternative is to declare `x-dead-letter-exchange` on the source queue and let the
broker move the message. It was considered and rejected, for a reason worth recording because
the readme currently recommends exactly this to users.

**Dead-lettering is a routing rule, not a retention guarantee.** It is what the broker does with
messages it has already given up on, and best-effort is what it was designed to be. RabbitMQ
republishes to the DLX *internally, without publisher confirms*: a dead-lettered message can be
lost if the target queue is unavailable, if its length limit is reached under `reject-publish`
overflow, or across a network partition. If the dead-letter exchange does not exist, messages
are silently dropped.

At-least-once dead-lettering does exist, but requires **quorum queues** plus
`dead-letter-strategy: at-least-once` plus `overflow: reject-publish`. **Classic queues do not
support it**, and comq declares classic queues — `#assertQueue` passes `{ durable: true }` with
no `x-queue-type`.

So this was never a choice between two implementations of one thing. We need the message kept;
dead-lettering does not promise to keep it. Using it would reintroduce silent loss on the exact
path built to prevent it — narrower than today, but the same class of bug.

- [Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [At-Least-Once Dead Lettering](https://www.rabbitmq.com/blog/2022/03/29/at-least-once-dead-lettering)
- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)

> **If comq ever moves to quorum queues** — with `dead-letter-strategy: at-least-once` and
> `overflow: reject-publish` — dead-lettering becomes lossless and this decision is worth
> revisiting. It would also close the Part 2 retry queue's caveat. Much larger change; its own
> decision, someday.

## The compatibility trap this avoids

Worth stating explicitly, because it is the reason the rejected alternative is *also* expensive:
declaring `x-dead-letter-exchange` means adding `arguments` to `#assertQueue`. Every durable
queue in every comq deployment today was declared **without** `arguments`, and RabbitMQ rejects
a redeclaration whose arguments differ with `406 PRECONDITION_FAILED`.

That failure would be loud rather than silent — the declaration happens inside the
`failsafe(this, this.#recover, …)` wrapper, `permanent()` ([:463](../source/channel.js#L463))
classifies `PRECONDITION_FAILED` as unrecoverable, and `io.consume(...)` rejects at wiring
time — but "the application does not start after the upgrade" is still a migration for every
user. Parking sidesteps it entirely: `comq.dead.<queue>` is a **new** queue, and the source
queue's declaration is untouched.

A migration would have been acceptable, so this is not what decided it — retention is. But it is a real saving, and it keeps the destination soft: a publish target can
be renamed or changed at any time, where `arguments` on a durable queue are permanent and every
later change is another migration.

## What the parked message carries

Only what a person doing a post-mortem needs. There is no compatibility requirement here —
nothing reads these but a human — so do not reproduce RabbitMQ's `x-death` format, and do not
build multi-hop machinery (`x-first-death-*` / `x-last-death-*`): a comq message parks once.

Everything needed is already in hand at the moment of parking. In `#dispose`:

```js
const headers = {
  ...message.properties.headers,          // x-attempt is already here
  'x-comq-queue': queue,                  // threaded in by Part 2 §3
  'x-comq-exchange': message.fields.exchange,
  'x-comq-key': message.fields.routingKey,
  'x-comq-reason': exception?.message,
  'x-comq-at': Date.now()
}
```

The only two that need deliberate copying are `exchange` and `routingKey`: they live in
`message.fields`, not `properties`, so a republish drops them unless they are moved across.

## The seam

Route the terminal branch through one method, so the destination is one function body and the
rest of the plan does not care what is in it:

```js
async #discard (queue, message, exception) {
  await this.#dispose(queue, message, exception)
  this.#diagnostics.emit('discard', message, exception)
}

// Where a message that has run out of attempts goes: a queue comq owns, published to
// before the original is released, so a message the broker holds twice is recoverable
// and one it no longer holds at all is not.
async #dispose (queue, message, exception) {
  const headers = { /* as above */ }
  const properties = { ...message.properties, headers, mandatory: true }

  await this.#publish(DEFAULT, deadQueueOf(queue), message.content, properties)
  this.#channel.ack(message)
}
```

`#dispose` is `async` and every caller sits inside `#failed`'s try/catch (Part 2 §4), so it
inherits the "cannot reject into amqplib" guarantee for free: if the parking publish fails, the
message is nacked back to the broker rather than lost.

`comq.dead.<queue>` is declared next to `comq.retry.<queue>` in `#assertRetryQueue` (Part 2 §2),
under the same rules — at consume time, mirroring the source queue's durability, no `x-expires`.

**Naming is coupled to Part 3.** If the verdict class is `Park`, the queue should be
`comq.parked.<queue>`; if `Dead`, `comq.dead.<queue>`. Pick the noun once — renaming it later
orphans whatever is sitting in the old queue.

## The one thing this does not fix

A parked message is out of the broker's way but still needs someone to look at it.
`comq.dead.*` queues grow without bound unless an operator drains them. That is the right
default — the alternative is deleting evidence — but the readme must say so, and the `discard`
diagnostic is the hook for alerting on it.

# Part 2 — The remaining fixes

None of these change an existing queue declaration, so none of them break an upgrade.

## Design

### The retry loop

On failure, publish the message to `comq.retry.<queue>` — a queue with **no consumer**,
declared with `x-message-ttl: 1000`, `x-dead-letter-exchange: ''` and
`x-dead-letter-routing-key: <queue>`. The broker holds it for the TTL, then returns it to the
queue it came from. Only after the publish is confirmed is the original acked.

The retry queue is **new**, so declaring it with `arguments` is safe — no existing queue is
redeclared, no `PRECONDITION_FAILED`.

Two constraints drive the details:

- **The retry queue cannot be a `lazy` initializer.** `call()` in
  [source/attributes/lazy.js:33](../source/attributes/lazy.js#L33) passes the *original, unspliced*
  `args` to every initializer, so one appended to the `subscribe`/`bound` chain would still see
  `queue === undefined` and memoize on that key. It has to go inside `#consume`.
- **It must be declared at consume time, not on first failure.** Declaring inside the catch
  block means a declaration error surfaces at 3am under load, and a declare failure there falls
  through to `nack(requeue: true)` → immediate redelivery → immediate re-failure → a hot loop
  with no delay and no attempt counting. Declaring in `#consume` puts the failure inside the
  `failsafe` wrapper, where `io.consume(...)` rejects at wiring time with a legible error. It
  also gets re-declared for free on `recover()` (which does `lazy.reset` + `recall(this)`),
  which matters for exclusive queues.

Cost, stated plainly: one extra, usually-empty queue per consumed queue. Skipped automatically
for the reply channel (`reply.json` is `acknowledgments: false`).

**Naming: `comq.retry.<queue>`.** `io.concat` uses `'..'` as its separator
([source/.io/concat.js](../source/.io/concat.js)), so `concat(queue, 'retry')` would produce
`<queue>..retry` — exactly what `io.consume('<queue>', 'retry', cb)` produces. A real
collision, not a hypothetical. The `comq.retry.` prefix cannot be produced by `concat`, groups
in the management UI, and gives operators one policy regex. **The name is a compatibility
surface** — changing it later orphans in-flight retries.

**Attempt count: the default stays 5.** `MAX_REDELIVERIES = 5` ([:481](../source/channel.js#L481))
already exists — added by the same `1df2afe` — and becomes the default of a `topology.attempts`
setting (see *What of this belongs in the public contract*, below). Note its actual arithmetic, because the readme gets it
wrong: the counter is the `x-attempt` header, absent on first delivery, so it reads `0` and the
message is retried. `5 >= 5` first holds on the **sixth** delivery. The consumer is therefore
invoked **six times** (one original + five retries), not five.
[readme.md:466](../readme.md#L466) — "causes exceptions five times in a row, it is discarded" — is
off by one *today*; correct it in §8 rather than changing the behaviour.

**Delay: `RETRY_DELAY = 1000`, a constant**
([:481](../source/channel.js#L481)). Feature tests run five retries sequentially against a 30s
per-step cucumber timeout ([features/steps/setup.js](../features/steps/setup.js)), so wall clock
is `5 × delay`: 1s is ~5–6s and comfortable, above 2s is flaky, above 4s impossible. If 1s
proves wrong for one of the two channel types: a `request` caller is blocked on `io.request()`
with no timeout, so `5 × delay` is added to its worst case, whereas nobody waits on an event.

### What of this belongs in the public contract

The attempt count is a knob. The delay is not, and the difference is worth being precise about.

**`attempts` — expose it.** It is a runtime comparison against a header and nothing else: no
declaration, no broker state, nothing other processes must agree on. Two processes consuming one
queue with different counts each give up at their own threshold — non-deterministic across a
mixed fleet mid-deploy, but nothing fails. It belongs in `Topology` next to `prefetch` and
`confirms`, per channel type, which is exactly what those presets are for. Cost is small and
contained:

- add `attempts` to `types/topology.d.ts` and to the three `source/topology/*.json` presets
  (`5` for `request` and `event`; it is unused on `reply`, which is `acknowledgments: false`)
- `source/connection.js:92` currently hands out the shared preset object as-is; make it merge —
  `{ ...presets[type], ...overrides?.[type] }` — rather than mutate it
- `Connect` is variadic (`(...urls: string[]) => Promise<IO>`, [types/connection.d.ts](../types/connection.d.ts)),
  so an override object is the optional trailing argument, detected by `typeof !== 'string'`
  and typed as `[...urls: string[], options: Options]`
- `test/presets.test.js` asserts the presets with `toStrictEqual`, so all three cases change

**`delay` — do not expose it.** `x-message-ttl` is a property of the *queue*, not of the message
or of the consumer, and every process consuming `orders..billing` shares one
`comq.retry.orders..billing`. So a user-overridable delay means: whoever declares the queue
first wins, and anyone configured differently gets `PRECONDITION_FAILED` and **fails to start** —
fired precisely by the rolling deploy that changes the value, which is the only time anyone
would change it. That is not a knob.

It could be dodged by putting the value in the queue name (`comq.retry.<delay>.<queue>`); that
genuinely works, since an old-delay queue keeps dead-lettering to the same unchanged source
queue and simply drains itself empty. But it reshapes the naming scheme to accommodate a setting
and leaves an orphaned queue behind on every change. Per-message TTL is ruled out separately
(head-of-line blocking, below). Neither is worth it: leave the delay a constant.

> **The same fact is a forward-looking hazard even as a constant.** Because the TTL is baked
> into the declaration, changing `RETRY_DELAY` in a *future* comq release makes every existing
> `comq.retry.*` queue fail redeclaration, and by this design the app will not start. Migration
> is "delete the retry queues", and it belongs in the release notes. Pick a number you can live
> with.

> **The retry queue inherits the at-most-once caveat described in Part 1.** The return
> hop is broker dead-lettering, which on classic queues republishes without publisher confirms
> — so a retried message can be lost if the source queue is unavailable when the TTL fires
> (target unavailable, length limit under `reject-publish`, or a network partition between the
> nodes hosting the two queues). This is still a large improvement on today's ack-before-publish
> loss, and the alternative — an in-process `setTimeout` — is worse, since it loses the delay on
> any restart. But it is a known limitation and belongs in the docs (§8), not left implicit.
> Moving comq to quorum queues would close it; see Part 1.

**Not per-message TTL.** A queue with mixed TTLs only expires from the head, so one long-TTL
message blocks every shorter one behind it. Uniform per-queue TTL means expiry order equals
enqueue order. Exponential backoff, if ever wanted, needs one queue per tier — separate design.

**No `x-expires` on the retry queue.** It looks like tidy orphan cleanup, but a retry queue
never has a consumer, so `x-expires` would delete it *with the messages waiting in it* during
any quiet period.

### Nothing in the failure path may reject

amqplib has nowhere to put a rejection, so every path out of the consumer wrapper must be
total. Fallback is `nack(message, false, true)` — hand the delivery back to the broker rather
than lose it — itself wrapped so it can't throw either.

`#publish` can reject three ways and all three correctly resolve to "give it back":
`'Channel closed'` from a dying channel, `INTERRUPTION` ([:479](../source/channel.js#L479)) from
`#unpaused()` on a failfast/sharded channel, and confirmation rejection during `recover()`
([:230](../source/channel.js#L230)).

Two extra defects found while designing, fixed in the same pass:
- [:377](../source/channel.js#L377) `exception.message` throws if a consumer does `throw undefined`
  → use `exception?.message`.
- [:381](../source/channel.js#L381) `this.#discard(...)` is not awaited; once it becomes the
  dead-letter seam (Part 1), an unawaited rejection there escapes.

### Consequences to accept and document

- **Ordering is not preserved across a failure.** A retried message re-enters the queue behind
  messages published while it waited. (Ordering was already not guaranteed — `prefetch: 300`
  means up to 300 concurrent in-flight deliveries.) Retries do not reorder among themselves.
- **At-least-once, not exactly-once.** Publish-before-ack means a crash between the two leaves
  the broker holding both the retry copy and the unacked original. Consumers must be
  idempotent. This is the deliberate trade against today's at-most-once silent loss.
- **A retry published to a deleted queue is silently dropped**, and publisher confirms still
  ack it. `mandatory: true` makes the broker return it so the `return` diagnostic fires, but
  asynchronously. Document "do not delete `comq.retry.*` on a running system".
- **`x-attempt` becomes user-visible** — consumers receive it in `properties.headers` and can
  tell which attempt they're on. Worth documenting as a feature. RabbitMQ also appends
  `x-death` on the way back and rewrites `routingKey` to the source queue name.

## Implementation

All in [source/channel.js](../source/channel.js) unless noted.

### 1. Record each queue's declaration options

The retry queue must mirror its source queue's lifetime — a durable retry queue behind an
exclusive `amq.gen-*` source leaks a durable queue whose dead-letter target no longer exists.
`#consume` can't re-derive this, because only `#assertBoundQueue`
([:303](../source/channel.js#L303)) passes the `{ exclusive: true }` override. Record it where it
is known:

- new field `#queues = new Map()` next to `#tags` ([:26](../source/channel.js#L26))
- `this.#queues.clear()` in `create()` next to `this.#tags = []` ([:72](../source/channel.js#L72))
  — a fresh amqplib channel has declared nothing
- `this.#queues.set(queue, options)` in `#assertQueue` ([:250](../source/channel.js#L250))

### 2. The retry and parking queues

Both mirror the source queue's durability; only the retry queue takes `arguments`. Reuses
`#assertQueue`'s existing `arguments[1]` options override ([:247](../source/channel.js#L247)) — no
signature change:

```js
#optionsOf (queue) {
  return this.#queues.get(queue) ?? (this.#topology.durable ? DURABLE : EXCLUSIVE)
}

async #assertRetryQueue (queue) {
  const options = {
    ...this.#optionsOf(queue),
    // replaces `arguments` wholesale rather than merging: a retry must return to the
    // queue it came from, never to the parking queue
    arguments: {
      'x-message-ttl': RETRY_DELAY,
      'x-dead-letter-exchange': DEFAULT,
      'x-dead-letter-routing-key': queue
    }
  }

  return (await this.#assertQueue(retryQueueOf(queue), options))[0]
}

async #assertDeadQueue (queue) {
  return (await this.#assertQueue(deadQueueOf(queue), this.#optionsOf(queue)))[0]
}
```

Plus `RETRY_PREFIX = 'comq.retry.'`, `DEAD_PREFIX = 'comq.dead.'`, `RETRY_DELAY = 1000`, and the
two `…QueueOf` helpers, where `MAX_REDELIVERIES` sits today
([:481](../source/channel.js#L481)) — that constant itself moves into the topology presets as
the default for `attempts`.

### 3. `#consume` declares them and threads the queue name

The queue name is fully resolved by `#consume` for all three paths — `lazy` splices the
initializer's return over `args` before the method body runs, so `consume`→`#assertQueue`,
`subscribe`→`#assertBoundQueue`, `bound`→`#assertKeyedQueue` all deliver the broker-confirmed
name (including generated `amq.gen-*` names for the exclusive case, `io.js:112`).

```js
// :352
if (this.#topology.acknowledgments) {
  await this.#assertRetryQueue(queue)
  await this.#assertDeadQueue(queue)
  consumer = this.#getAcknowledgingConsumer(queue, consumer)
} else options.noAck = true
```

`#getAcknowledgingConsumer` becomes `(queue, consumer) => async (message) => {...}`; single
call site at [:356](../source/channel.js#L356). Declare the source queue **before** the retry
queue — existing tests at [test/channel.test.js:386](../test/channel.test.js#L386) and `:407` read
`assertQueue.mock.results[0]`.

### 4. Rewrite the failure path

Replace `#getAcknowledgingConsumer` / `#requeue` ([:370-400](../source/channel.js#L370)) with:

```js
#getAcknowledgingConsumer = (queue, consumer) =>
  async (message) => {
    try {
      await consumer(message)
      this.#channel.ack(message)
    } catch (exception) {
      if (exception?.message === 'Channel closed') return // the broker requeues it
      await this.#failed(queue, message, exception)
    }
  }

// Nothing here may reject: amqplib dispatches a delivery through an event emitter and
// drops the promise it gets back, so a rejection has no one to catch it and takes the
// process down.
async #failed (queue, message, exception) {
  try {
    const attempt = message.properties.headers?.[REDELIVERY_HEADER] ?? 0

    if (attempt >= this.#topology.attempts) await this.#discard(queue, message, exception)
    else await this.#retry(queue, message, attempt, exception)
  } catch {
    this.#nack(message) // hand it back rather than lose it
  }
}

async #retry (queue, message, attempt, exception) {
  const headers = { ...message.properties.headers, [REDELIVERY_HEADER]: attempt + 1 }
  const properties = { ...message.properties, headers, mandatory: true }

  // the copy is placed before the original is released: a message the broker holds
  // twice is recoverable, one it no longer holds at all is not
  await this.#publish(DEFAULT, retryQueueOf(queue), message.content, properties)

  this.#channel.ack(message)
  this.#diagnostics.emit('retry', message, exception, attempt + 1)
}

#nack (message) {
  try { this.#channel.nack(message, false, true) } catch { /* nothing left to do */ }
}
```

`#retry` **copies** the properties rather than mutating them as
[:396](../source/channel.js#L396) does — the mutated message must not reach the fallback `nack`,
and a user consumer may still hold a reference.

`#discard` / `#dispose` are as given in Part 1.

### 5. Wire the `retry` diagnostic

- [source/events.js:7](../source/events.js#L7) — add `'retry'` to `exports.channel`. This single
  switch makes both `source/io.js:271` forward it to `IO.diagnose` **and**
  `source/shards/channel.js:183` `#pipe` forward it with the shard index appended.
- [types/diagnostic.d.ts:4](../types/diagnostic.d.ts#L4) — add `'retry'` to the `Event` union.
- [types/io.d.ts:106](../types/io.d.ts#L106) — add the `retry` overload. **Also fix the
  pre-existing bug on that line**: `discard` is declared `(channel, message, index?)` but
  `channel.js:408` has always passed the exception too.
- [test/io.diagnostics.test.js:31](../test/io.diagnostics.test.js#L31) — add `'retry'` to the
  hardcoded re-emit list.
- [features/steps/context.js:124](../features/steps/context.js#L124) — add `'retry'` to `EVENTS`.

### 5b. Make `attempts` configurable

Small and self-contained; the reasoning is under *What of this belongs in the public contract*.

- `source/topology/{request,event}.json` — add `"attempts": 5`. Leave `reply.json` alone; it is
  `acknowledgments: false`, so nothing there ever counts an attempt.
- [types/topology.d.ts](../types/topology.d.ts) — add `attempts: number` to `Topology`.
- [source/connection.js:92](../source/connection.js#L92) — `const topology = presets[type]` hands
  out the shared module-level preset object. Make it merge into a copy,
  `{ ...presets[type], ...this.#overrides?.[type] }`, and never mutate the preset.
- [source/connect.js](../source/connect.js) — `Connect` is variadic
  (`(...urls: string[]) => Promise<IO>`), so the overrides are an optional trailing argument,
  taken when `typeof last !== 'string'` and typed as `[...urls: string[], options: Options]`.
  Thread it through `create()` → `IO` → `Connection`.
- [test/presets.test.js](../test/presets.test.js) — all three cases assert with `toStrictEqual`,
  so all three change.
- New tests: an override reaches the channel; an absent override leaves the preset untouched
  (assert the module object is not mutated across two connections); a consumer configured with
  `attempts: 1` parks on the second delivery rather than the sixth.

### 6. Unit tests — new `describe('retry')` in [test/channel.test.js](../test/channel.test.js)

`test/amqplib.mock.js` needs no changes. **`test/channel.fixtures.js` randomises `durable`,
`confirms` and `acknowledgments` with `flip()`** — every new test must set the ones it asserts
on explicitly, and the file should be run repeatedly.

Declaration: retry queue asserted with the right name and arguments, and parking queue with the
right name and **no** arguments; both asserted *after* the source queue; **neither** asserted
when `acknowledgments: false`; both exclusive when the source is exclusive (test both values of
`durable`); both asserted for the `bound` path; both re-asserted after `recover()`.

Failure path — the regression tests that matter:
- **publishes before acking** —
  `chan.publish.mock.invocationCallOrder[0] < chan.ack.mock.invocationCallOrder[0]`
- **waits for the confirmation** — `confirms: true`, capture the 5th publish arg, assert `ack`
  not yet called, invoke the callback, assert it then is
- **does not republish to the original exchange** — build the message with a random
  `fields.exchange`; assert the publish target is `''` / `comq.retry.<queue>`. *(the fanout
  re-delivery regression)*
- **tolerates a message with no headers** — `properties = {}`. *(the non-comq-publisher
  `TypeError` regression)*
- **does not throw** — `await expect(callback(message)).resolves.not.toThrow()`. *(the
  process-crash regression)*
- **does not seal** — `chan.cancel` not called, `seal` spy not called, and a subsequent
  `channel.consume(...)` still works *(proves `#sealed` is still false)*
- increments `x-attempt`; does not mutate `message.properties`; emits `retry` with the attempt
- **defensive fallback**: publish throws → `nack(message, false, true)`, no `ack`, resolves;
  publish *and* nack both throw → still resolves; confirmation rejected → same as publish throw
- consumer throwing `'Channel closed'` → no publish, no nack, no ack (complements the existing
  test at [:144](../test/channel.test.js#L144), which covers `ack` throwing)
- consumer doing `throw undefined` → resolves *(covers the `exception?.message` guard)*
- **terminal**: `x-attempt: 5` → published to `comq.dead.<queue>`, **not** to the retry queue;
  published before acking, same order assertion as above; carries the `x-comq-*` headers
  including the original `fields.exchange` and `fields.routingKey`; `nack` not called. Restores
  the spirit of the `it.each` requeue test `1df2afe` deleted. The existing `should emit
  'discard' event` ([:894](../test/channel.test.js#L894)) needs its message fixture extended with
  `fields` — it currently has none, which works only because today's `#discard` never reads
  them.
- **parking failure**: publish to the dead queue throws → `nack(message, false, true)`, no
  `ack`, resolves. The message survives an unavailable parking queue.

### 7. Feature tests — rewrite [features/events.poison.feature](../features/events.poison.feature)

Both scenarios drop `@manual`. Two structural facts shape this:

- `features/steps/brokers.js` starts containers in `BeforeAll` and `hooks.js` only disconnects,
  so **durable queues and their contents survive across scenarios**. A message still cycling
  through a retry queue will land in the next scenario's consumer. **Use a distinct exchange
  name per scenario** — do not share `poison`.
- [features/steps/events.js:41](../features/steps/events.js#L41) builds the throwing consumer.
  Change it to record `properties.headers?.['x-attempt']` into a new `this.attempts` array,
  which turns the whole retry loop into an end-to-end assertion against a real broker.

```gherkin
Scenario: A poison event is retried and then discarded
  Given that events from the `poison_retried` exchange are causing exceptions
  When an event is emitted to the `poison_retried` exchange
  Then the event is attempted 6 times
  And the message is parked

Scenario: A poison event does not stop other consumers
  Given that events from the `poison_isolated` exchange are causing exceptions
  And that `checker` is consuming events from the `numbers_added` exchange
  When an event is emitted to the `poison_isolated` exchange
  And after 1500ms
  And an event is emitted to the `numbers_added` exchange
  Then `checker` receives the event

Scenario: A retried event is not re-delivered to the other consumers of its exchange
  Given that events from the `poison_open` exchange are causing exceptions
  And that `witness` is consuming events from the `poison_open` exchange
  When an event is emitted to the `poison_open` exchange
  And after 3000ms
  Then `witness` has received 1 event
```

Scenario 2 is the direct proof the channel is not sealed — `numbers_added` and
`poison_isolated` share the one `#events` channel, so under today's code the second
`emit`/`consume` is dead. Scenario 3 is the fanout regression: exactly once, not once per retry.

Steps needed:
- `Then the event is attempted {int} times` (new, `features/steps/poison.js`) — poll
  `this.attempts` to a deadline, then `assert.deepEqual(this.attempts, [0, 1, 2, 3, 4, 5])`.
  Asserts count, header increment, and that the delay round-trips through the broker. Six
  entries, per the arithmetic above — the first delivery has no `x-attempt` header.
- `Then the message is discarded` — **already exists** at
  [features/steps/poison.js:7](../features/steps/poison.js#L7) and is currently orphaned (no
  feature file references it). It becomes live; change its `await timeout(300)` to a polling
  wait, via a new `until(predicate, ms)` helper in `test/helpers.js` next to `timeout`.
- `Then the message is parked` (new) — the real end-to-end assertion, and only possible because
  Part 1 gives comq a queue it owns: `io.process('comq.dead.<queue>', …)` and assert the payload
  arrives, carrying `x-attempt: 5` and the `x-comq-*` headers. Under today's code, and under a
  broker-side DLX, there would be nothing to consume. Prefer this over the diagnostic-flag step
  wherever both would work — it proves the message actually survived, not just that comq
  believes it did.
- `Then {token} has received {int} event(s)` (new, `features/steps/events.js`) — needs
  per-group counts; today only a single global `eventsConsumedCount` and a last-value-only
  `consumed[group]` exist.
- `features/steps/context.js` — add `attempts = []` and `counts = {}`, reset on disconnect.

### 8. Docs

Replace [readme.md:464-470](../readme.md#L464) (which currently documents the sealed channel and
the "configure a DLX yourself" workaround) with prose covering: the retry queue and its name;
`x-message-ttl` + `x-dead-letter-exchange` as the delay mechanism; `x-attempt` visible to
consumers; **six attempts by default** — one original plus five retries — then `discard`,
correcting the existing off-by-one at [readme.md:466](../readme.md#L466), and noting that the
count is the `attempts` topology setting while the delay is fixed; **the channel keeps consuming**; ordering not
preserved across a failure; at-least-once / consumers must be idempotent; retries confirmed for
Events but best-effort for Requests (`confirms: false`, `persistent: false`), and a discarded
Request is never answered — the caller waits indefinitely, which with a limited prefetch can
deadlock it; do not delete `comq.retry.*` or `comq.dead.*` on a running system; and **the retry
queue's return hop is at-most-once on classic queues** — a retry can be lost if the source queue
is unavailable when the TTL fires.

Then the parking half, from Part 1: comq publishes the exhausted message to `comq.dead.<queue>`
and acks only once the broker confirms it, so it is not deleted and not dependent on a
broker-side policy; the `x-comq-*` headers it carries; that these queues **grow until someone
drains them**, which is deliberate — the alternative is deleting evidence — and that `discard`
is the diagnostic to alert on.

**Delete the current recommendation to configure a dead-letter policy**
([readme.md:468-470](../readme.md#L468)). It is no longer needed, and the reasoning in Part 1 —
that broker dead-lettering is at-most-once on classic queues — means it was never the guarantee
it appeared to be. A DLX on the parking queue itself remains a user's choice; say nothing about
it either way.

Add `retry` to the diagnostics list at [readme.md:556](../readme.md#L556), and `x-attempt` plus the
`x-comq-*` parking headers to `docs/headers.md`.

## Not affected — checked

- `source/shards/channel.js:59` delegates `consume`/`subscribe`/`bound` to per-shard `Channel`s.
  Each shard is a separate broker with its own copy of the queue, declares its own
  `comq.retry.*` and `comq.dead.*`, and returns retries to its own source. Self-contained —
  though note a parked message lives on the shard that failed it, so a post-mortem means
  looking at every shard. `#retry` uses
  `#publish` directly (not the `failsafe`-wrapped `publish`), so on a paused failfast shard it
  throws `INTERRUPTION` → `#nack` → the message stays on that shard. Acceptable.
- `IO.seal()` / `IO.close()` and the `#sealed` guards at `:88`, `:101`, `:119` are the
  *explicit* seal and stay exactly as they are. Only the failure path stops calling `seal()`.
- `source/emitter.js:11` swallows listener exceptions, so a bad `retry` listener can't
  re-introduce the crash.
- Existing assertions the extra `assertQueue` call could have broken, all verified safe:
  `channel.test.js:185`/`:191` (`send` path, no retry queue), `:358` (`assertExchange` count),
  `:387` (`bindQueue` count — the retry queue is never bound), `:74`/`:363`
  (`toHaveBeenCalledWith`, not counts). Only the `mock.results[0]` reads depend on ordering,
  which the "source queue first" rule preserves.
- `test/io.*.test.js` use the channel-level `test/connection.mock.js`; unaffected.

## Verification

1. `npm test` (`standard && jest`) — run `npx jest test/channel.test.js` **several times**,
   since `test/channel.fixtures.js` randomises the topology per run.
2. `npm run features` (needs Docker; Testcontainers starts two RabbitMQ containers). Time the
   poison feature specifically — 5 attempts in one step at a 1s delay is the tightest new
   timing in the suite, against a 30s per-step cucumber timeout.
3. The end-to-end proof is that `features/events.poison.feature` becomes ordinary automatic
   scenarios: a consumer that throws, a message that comes back five times with an incrementing
   `x-attempt` (six deliveries in total), a message that ends up disposed rather than silently
   gone, and — the point of the whole exercise — a *sibling* consumer still alive afterwards.
4. Confirm the process no longer exits: today, running the poison scenario ends the node
   process. After the change it should complete the scenario.
5. Inspect the broker after a features run — `comq.retry.*` empty, `comq.dead.*` holding
   exactly the messages the poison scenarios parked, with their `x-comq-*` headers intact.
6. Branch off `dev` (not `release`).

---

# Part 3 — A consumer says how it failed (`Retry` / `Park`)

A follow-up proposal lets a consumer classify its failure: `throw new Retry()` for a
dependency that was briefly absent, `throw new Park()` for a message this consumer will never
process. A bare rejection means `Retry`.

## What it changes in this plan: almost nothing

**None of the six defects change.** Every one of them exists whether or not a consumer can
classify its failure — the verdict is a *routing* decision layered on the failure path, not a
fix to it. Parts 1 and 2 stand exactly as written, and remain worth landing on their own: a
`Park()` that reaches today's `#requeue` still seals the channel and still kills the process.

**It adds one branch**, in `#failed` (Part 2 §4). The seam already exists:

```js
const park = verdictOf(exception) === PARK || attempt >= this.#topology.attempts

if (park) await this.#discard(queue, message, exception)
else await this.#retry(queue, message, attempt, exception)
```

`Retry` still respects `topology.attempts` — a consumer can say "worth another attempt" without
being able to say "forever". comq keeps its own count, which is what the proposal's "no
counts" asks for.

**Part 1 already covers it.** Parking is the destination whether the message got there by
exhausting its attempts or by a consumer saying so on the first delivery. `Park()` does raise
the stakes — parking stops being a rare terminal event and becomes a routine outcome a consumer
chooses deliberately — which is a further argument for Part 1's decision, and an argument
against ever making it opt-in.

## Thrown, not returned — the return channel is already taken

[source/io.js:305](../source/io.js#L305): `const reply = await producer(payload)`. For `io.reply`,
**what the consumer returns is the reply**, and [io.js:308](../source/io.js#L308) then inspects it
for iterator-ness to choose streaming versus a single reply. A returned symbol or verdict object
would be encoded and sent to the caller as the answer. `types/io.d.ts:10` says the same:
`Producer<Input, Output> = (message) => Output | Promise<Output>`.

Event consumers ([io.js:345](../source/io.js#L345)) do ignore their return value, so returning would
work *there* — but a verdict that works for `consume`/`process` and not for `reply` is worse
than one that works everywhere. Second reason: a thrown verdict can be raised from anywhere in
the call stack, so a validation helper three frames down can park the message; a return can only
be made by the top-level function.

## Shape

```js
// source/verdicts.js — its own module, so source/channel.js can require it
// without going through the package entry point
'use strict'

// the global registry, so two copies of comq in one dependency tree still agree
const VERDICT = Symbol.for('comq.verdict')

const RETRY = 'retry'
const PARK = 'park'

class Retry extends Error { [VERDICT] = RETRY }
class Park extends Error { [VERDICT] = PARK }

// a rejection nobody classified is a rejection nobody chose
const verdictOf = (exception) => exception?.[VERDICT] ?? RETRY
```

Two deliberate choices:

- **`Symbol.for` brand, not `instanceof`.** comq is a library others depend on; two copies in
  one dependency tree (Toa pins one version, the app resolves another) makes `instanceof`
  silently `false`. A `Park` would then be read as a bare rejection, retried six times, and
  parked anyway — the right outcome, six retry cycles late, with six spurious `retry`
  diagnostics. The global symbol registry is shared across copies; a class identity is not.
- **`extends Error`**, so a verdict carries a stack, a `message`, and `cause`. A bare
  `new Park()` would throw the cause away, and the `discard` diagnostic's second argument
  ([channel.js:408](../source/channel.js#L408)) would be a marker with nothing about what actually
  went wrong. Use `new Park('…', { cause })` and record both in the parking headers —
  `x-comq-reason` from the verdict's own message, and the cause's message alongside it.

## Consumer code

```js
const { Retry, Park } = require('comq')

// events — fanout
await io.consume('orders', 'billing', async (order) => {
  if (typeof order.total !== 'number') throw new Park('no total on order')

  try {
    await billing.charge(order)
  } catch (e) {
    throw new Retry('billing unavailable', { cause: e })   // or just: throw e
  }
})

// tasks
await io.process('emails', async (job) => {
  await mailer.send(job)          // a bare throw means Retry
})

// requests — the return value is the reply, so the verdict must be thrown
await io.reply('compute', async (input) => {
  if (typeof input.n !== 'number') throw new Park('n must be a number')

  return { result: input.n * 2 }  // ← the return channel is already spoken for
})
```

## The footgun the proposal does not mention

**`Park` on an `io.reply` producer hangs the caller.** No reply is ever sent, so the requester's
promise never settles — the prefetch deadlock [readme.md:469](../readme.md#L469) already admits.
Today that happens by accident, after six failures. With `Park()` it happens deliberately on the
first delivery: a consumer says "I will never process this" and silently hangs the requester
forever, which is a worse failure than the accident because it is now the documented path.

Three ways out, to decide before building: document it and leave it; have `Park` on a request
send an error reply (a protocol change — what does an error reply look like to the caller?); or
reject `Park` on the request path as a usage error. Not decided here.

## Sequencing

Land Parts 1 and 2 first. The crash is a dead process today; the verdict API is additive and
non-breaking (bare rejection = `Retry` = the behaviour Part 2 establishes), so it composes
cleanly on top as a minor release.

One thing argues for doing them together: Part 1 names the parking queue and Part 3 names the
class, and they should agree — `Park` → `comq.parked.<queue>`, or `Dead` →
`comq.dead.<queue>`. Naming it twice means renaming a queue in a later release, which orphans
whatever is sitting in the old one. **Pick the noun once**, before Part 1 is implemented; it is
the only thing Part 3 needs decided up front.

## Surface it adds

- `source/index.js` currently exports only `connect` and `assert`, and comq has no exported
  error classes at all — `Retry`/`Park` would be the first. Clean addition, plus
  `types/index.d.ts` (which re-exports from `./io`; add the two classes there).
- `source/verdicts.js` is required directly by `source/channel.js`, not through
  `source/index.js` — `index.js` pulls in `connect`, and the channel must not depend on it.
- Unit tests: `verdictOf` returns `RETRY` for `undefined`, `null`, a string throw, a plain
  `Error`, and an object with a *different* symbol key; returns `PARK` only for the brand. Then
  in `test/channel.test.js`, a consumer throwing `Park` publishes to the parking queue on the
  **first** delivery with no retry publish, and a consumer throwing `Retry` behaves exactly like
  a bare rejection.
- One feature scenario per verdict: a `Park()` on first delivery lands in the parking queue with
  no retry cycle at all (and completes fast, since it skips five TTL waits — a useful contrast
  with the six-attempt scenario's ~6s); a `Retry()` behaves exactly as a bare rejection.
- Docs: the verdicts get their own readme section, and the `x-comq-reason` header note in
  `docs/headers.md` should mention that a `cause` is recorded alongside it.

---

# Context

## The six defects

All introduced by `1df2afe` *refactor: throw exceptions on poison messages*, in
`#getAcknowledgingConsumer` ([:370](../source/channel.js#L370)) and `#requeue`
([:393](../source/channel.js#L393)).

1. **It acks before it publishes.** [:394](../source/channel.js#L394) acks, then
   [:399](../source/channel.js#L399) publishes. A crash between the two loses the message.
2. **It republishes to `message.fields.exchange`.** For a queue bound to a fanout exchange that
   *is* the exchange, so a retry meant for the one subscriber that failed is fanned out to
   every subscriber again.
3. **It seals the channel** ([:398](../source/channel.js#L398)). `seal()` cancels every consumer tag
   on the channel; `#sealed` is never cleared (not even by `recover()` at
   [:213](../source/channel.js#L213)) and `recall.reset` at [:198](../source/channel.js#L198) throws
   away the callbacks that would let them come back. And it is worse than one subscription:
   [source/io.js](../source/io.js) routes `consume`, `emit`, `route`, `subscribe`, `process` **and**
   `enqueue` through a single `#events` channel, so one poison event permanently silences every
   event consumer *and* every task processor in the process.
4. **It rethrows into amqplib** ([:384](../source/channel.js#L384)), which dispatches deliveries
   through an EventEmitter listener (`amqplib/lib/channel_model.js:47` →
   `lib/channel.js:455 return consumer(message)`) and drops the returned promise. Unhandled
   rejection, and Node ends the process by default. That crash *is* the current retry
   mechanism: [features/events.poison.feature](../features/events.poison.feature) is entirely
   `@manual` and instructs a human to "run this scenario five times".
5. **It reads `message.properties.headers[...]` unguarded**
   ([:379](../source/channel.js#L379), [:396](../source/channel.js#L396)) — see the correction below.
   [source/shards/channel.js:204](../source/shards/channel.js#L204) already guards the identical
   pattern with `?.`.
6. **The last attempt destroys the message** — Part 1.

## Details worth knowing

Findings from verifying the above against the code and against amqplib, kept because they
correct claims that get made about this area.

- **The unguarded header read is narrower than it looks.** It is often described as breaking for
  any task, broadcast or request. It does not, for anything comq published:
  `amqplib/lib/api_args.js:191` does `Object.create(options.headers || null)` and always assigns
  `headers` into the publish properties, and `lib/codec.js:65` encodes with
  `for (const key in val)`, walking the prototype chain. So every comq-published message arrives
  with a headers table, at minimum `{}`. The `TypeError` is real only for a message published by
  a **non-comq client** that omits the field table (`defs.js:3438`, `headers: void 0` is the
  decode default). Guard it anyway — `source/shards/channel.js:204` already guards the identical
  pattern — but it is not the common case.
- **Publisher confirms cover events only.** `source/topology/request.json` is `confirms: false`
  and the channel is created with `createChannel`, not `createConfirmChannel`
  ([channel.js:68](../source/channel.js#L68)) — there is no confirm to await on the request channel.
  Requests are also `persistent: false`, so a requeued request does not survive a broker restart
  regardless. This is why Part 2 fixes requests structurally but calls them best-effort.
- **`MAX_REDELIVERIES = 5` means six deliveries, not five.** The counter is the `x-attempt`
  header, absent on the first delivery, so it reads `0` and the message is retried; `5 >= 5`
  first holds on the sixth. [readme.md:466](../readme.md#L466) says "five times in a row" and is off
  by one today.
- **Test coverage for this path collapsed in `1df2afe`.** That commit deleted the requeue unit
  test and the one automated scenario in `features/rpc.feature`, replaced them with two
  `@manual` scenarios that assert nothing, and left the `the message is discarded` step in
  `features/steps/poison.js` referenced by no feature file at all.

## Decisions already taken

- **Retry delay: broker-side delay queue (TTL + DLX).** Survives a process restart and does not
  hold an unacked delivery against prefetch.
- **`seal()` on poison is replaced by a diagnostics event only.** The channel keeps consuming.
  No circuit breaker.
- **Requests get the same structural fixes, best-effort.** `request.json` is not changed; the
  limitation is documented.
- **Parking, not broker dead-lettering** (Part 1). Decided on retention, with the migration cost
  ruled acceptable and therefore not a criterion: dead-lettering on classic queues can still
  lose the message, and the point of keeping it is that it is kept.

## Still open

- **The noun.** `Park` / `comq.parked.<queue>` or `Dead` / `comq.dead.<queue>` — pick before
  implementing Part 1, since Part 3 must match it and renaming the queue later orphans its
  contents. This document writes `comq.dead.<queue>` throughout as a placeholder.
- **`Park` on an `io.reply` producer** hangs the caller forever. Document it, send an error
  reply, or reject it as a usage error — see the end of Part 3. Only blocks Part 3.
- **Whether Part 3 is built at all**, and when. Parts 1 and 2 do not depend on it.
