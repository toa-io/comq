# comq — reconnection hang fix plan

This document describes the defects identified in the single-connection
reconnection path (`source/connection.js`, `source/channel.js`,
`source/attributes/failsafe.js`) and concrete, minimally-invasive fixes for
each one. Problems are ordered by their likelihood of producing the observed
symptom: *"after RabbitMQ connection is lost, the application is sometimes
never recovered."*

---

## Problem 1 — Deadlock in `Channel.recover()` via `recall()` + `failsafe`

### Symptom

During reconnect, `Channel.recover()` rebuilds the AMQP channel and then
replays previously recorded `consume` / `subscribe` calls via `recall(this)`.
`#recovery` is resolved only *after* `recall(this)` completes:

```142:160:source/channel.js
async recover (connection) {
    this.#connection = connection

    await this.create()

    lazy.reset(this)
    await recall(this)

    this.#unpause(INTERRUPTION)

    for (const confirmation of this.#confirmations) confirmation.reject(INTERRUPTION)

    // handle interruptions
    await new Promise(resolve => setTimeout(resolve, 0))

    this.#recovery.resolve()
    this.#recovery = new Promex()
    this.#diagnostics.emit('recover')
  }
```

The replayed methods are wrapped in `failsafe(this, this.#recover, ...)`. If
any replayed operation throws a *non-permanent* exception (`Channel closed`,
`Channel ended, no reply will be forthcoming`, or the internal
`INTERRUPTION`), `failsafe` calls:

```333:336:source/channel.js
async #recover (exception) {
    if (permanent(exception)) return false
    else await this.#recovery
  }
```

`failsafe` now awaits `this.#recovery`, which is the same Promex the enclosing
`recover()` is supposed to resolve further down. `recall(this)` cannot
finish, so `#recovery` is never resolved — the channel is stuck, and every
`send`/`publish`/`consume` parked on `failsafe → #recovery` hangs **forever**.

This reliably happens when the freshly created channel dies mid-setup, which
is common after a broker restart while heartbeats are still flapping, or
when `#assertQueue`/`#assertExchange` hits a transient amqplib "Channel
closed" race.

### Fix

Add a reentrancy guard so that `failsafe.#recover` refuses to wait on
`#recovery` while `recover()` is itself running — it must propagate instead,
letting `recall()` surface the failure to `Connection.#open`, which (after
Problem 2 is fixed) will ask `retry()` for another reopen attempt.

```js
// source/channel.js
#recovering = false

async recover (connection) {
  this.#recovering = true
  try {
    this.#connection = connection
    await this.create()
    lazy.reset(this)
    await recall(this)
    this.#unpause(INTERRUPTION)
    for (const confirmation of this.#confirmations) confirmation.reject(INTERRUPTION)
    await new Promise(resolve => setTimeout(resolve, 0))
    this.#recovery.resolve()
    this.#recovery = new Promex()
    this.#diagnostics.emit('recover')
  } finally {
    this.#recovering = false
  }
}

async #recover (exception) {
  if (permanent(exception)) return false
  if (this.#recovering) return false // never wait on #recovery from inside recover()
  await this.#recovery
}
```

Alternative: wrap `recall(this)` in try/catch inside `recover()`, and on
failure, reject the *old* `#recovery` (with a sentinel), create a fresh one,
and rethrow. The reentrancy guard is simpler and strictly local.

### Test

Add a unit test in `test/channel.test.js` that:

1. Creates a channel, records a `consume` call.
2. Triggers `recover()` but makes the mocked `channel.consume` throw a
   `new Error('Channel closed')` on the replay.
3. Asserts `recover()` rejects (rather than hanging) within a short timeout.

---

## Problem 2 — `channel.recover()` errors escape the `retry()` loop in `Connection.#open`

### Symptom

Only `amqp.connect` is guarded by try/catch in `#open`; channel recovery
runs *after* the catch block:

```73:92:source/connection.js
#open = async (retry) => {
    try {
      this.#connection = await amqp.connect(this.#url)
    } catch (exception) {
      if (this.#transient(exception)) return retry
      else throw exception
    }

    // This prevents the process from crashing; 'close' will be emitted next.
    // https://amqp-node.github.io/amqplib/channel_api.html#model_events
    this.#connection.on('error', noop)

    this.#connection.on('close', this.#close)
    this.#diagnostics.emit('open')

    for (const channel of this.#channels) await channel.recover(this.#connection)

    this.#recovery.resolve()
    this.#recovery = new Promex()
  }
```

If any `channel.recover()` throws (permanent topology error such as
`PRECONDITION_FAILED`, or the freshly opened connection dies before channel
creation completes, or the deadlock from Problem 1 is broken by rejection),
`#open` rejects → `retry()` rethrows → `open()` rejects. And `open()` was
called from:

```97:103:source/connection.js
#close = async (error) => {
    this.#diagnostics.emit('close', error)
    this.#connection.removeAllListeners()
    this.#connection = undefined

    if (error !== undefined) await this.open()
  }
```

…which has no error handler — rejection becomes an `unhandledRejection`, and
the Connection stops trying to reconnect. Whether the broken amqplib
`Connection` eventually emits another `close` to re-arm the flow is not
guaranteed (TCP half-open, missing heartbeat). The process ends up with a
live event loop but no broker connectivity.

### Fix

Keep channel recovery inside the `retry()` contract: on any failure, close
the half-baked connection and ask `retry` to try again.

```js
#open = async (retry) => {
  try {
    this.#connection = await amqp.connect(this.#url)
  } catch (exception) {
    if (this.#transient(exception)) return retry
    else throw exception
  }

  this.#connection.on('error', noop)
  this.#connection.on('close', this.#close)
  this.#diagnostics.emit('open')

  try {
    for (const channel of this.#channels) {
      await channel.recover(this.#connection)
    }
  } catch (exception) {
    this.#diagnostics.emit('error', exception)
    // prevent close re-entry from this broken connection
    this.#connection.removeAllListeners()
    try { await this.#connection.close() } catch {}
    this.#connection = undefined
    return retry
  }

  this.#recovery.resolve()
  this.#recovery = new Promex()
}
```

This keeps `retry()` in charge, honours its backoff, and never surfaces an
unhandled rejection to `#close`.

### Test

In `test/connection.test.js`, mock `channel.recover` to throw once, then
succeed; assert `amqplib.connect` is called at least twice and `createChannel`
eventually resolves.

---

## Problem 3 — Unhandled rejection from `#close`

### Symptom

`#close` is an event handler attached to the amqplib `Connection`'s `close`
event. It `await this.open()` with no surrounding `try/catch`. If `open()`
rejects (see Problem 2), the rejection becomes an `unhandledRejection`. On
processes that exit on unhandled rejections, this kills the app; on others,
it silently leaves the library without a working connection.

### Fix

Detach lifecycle from the event emitter so that the rejection is either
swallowed on purpose (with diagnostics) or restarted:

```js
#close = (error) => {
  this.#diagnostics.emit('close', error)
  this.#connection.removeAllListeners()
  this.#connection = undefined

  if (error !== undefined) {
    this.open().catch((exception) => this.#diagnostics.emit('error', exception))
  }
}
```

Users that observe diagnostics get a signal (the existing `close` diagnostic
plus a new `error` diagnostic) without the process being destabilised.

### Test

Subscribe to the `error` diagnostic, force `open()` to reject, emit `close`
with an error on the mocked amqp connection, assert the diagnostic fires and
the process does not register an unhandled rejection.

---

## Problem 4 — `#transient` is too narrow on the initial connect

### Symptom

```109:114:source/connection.js
#transient (exception) {
    const abruptly = exception.message === 'Socket closed abruptly during opening handshake'
    const tls = exception.message === 'Client network socket disconnected before secure TLS connection was established'

    return this.#running || abruptly || tls
  }
```

Before `#running` flips to `true` (i.e. on the *first* `open()`), only two
exact error messages are considered transient. Everyday transient failures
(`ECONNREFUSED`, `EAI_AGAIN`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`) cause
the boot to throw instead of retrying, forcing process supervisors to do the
retry. After first connect, `#running` is `true` forever, so *everything*
becomes transient — the asymmetry between "before first open" and "after
first open" is surprising.

### Fix

Introduce an explicit whitelist of transient failures that applies in both
phases:

```js
#transient (exception) {
  const transientCodes = new Set([
    'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH'
  ])
  const transientMessages = new Set([
    'Socket closed abruptly during opening handshake',
    'Client network socket disconnected before secure TLS connection was established'
  ])

  if (this.#running) return true
  if (transientCodes.has(exception.code)) return true
  if (transientMessages.has(exception.message)) return true
  return false
}
```

Optionally gate the `#running` shortcut behind a maximum attempt count or a
"permanent" classifier for things like `ACCESS_REFUSED`, so a misconfigured
credential doesn't retry forever — but that is a separate behaviour change
and should be opt-in.

### Test

Parametrised test in `test/connection.test.js` for each listed error code,
asserting `open()` resolves after one failing `amqplib.connect`.

---

## Problem 5 — Reentrant `#close` can run two overlapping `#open` loops

### Symptom

If the new connection dies *while* `#open` is still iterating
`channel.recover()`, amqplib fires `close` on that connection. The handler
executes:

```js
this.#connection.removeAllListeners()
this.#connection = undefined
if (error !== undefined) await this.open()
```

While the outer `#open` is still running and will, on its next loop
iteration, pass the now-`undefined` `this.#connection` to `channel.recover`
(crash → see Problem 2). You now have two concurrent `open()` retry loops
racing; whichever one wins may leave the other with a live amqp connection
that's unreferenced.

### Fix

Serialise `open()` with a single in-flight promise, and stop reading
`this.#connection` as a shared variable mid-loop:

```js
/** @type {Promise<void> | null} */
#opening = null

async open () {
  if (this.#opening !== null) return this.#opening
  this.#opening = retry(this.#open).finally(() => { this.#opening = null })
  await this.#opening
  this.#running = true
}

#open = async (retry) => {
  let connection
  try {
    connection = await amqp.connect(this.#url)
  } catch (exception) {
    if (this.#transient(exception)) return retry
    else throw exception
  }

  connection.on('error', noop)
  connection.on('close', this.#close)
  this.#connection = connection
  this.#diagnostics.emit('open')

  try {
    for (const channel of this.#channels) await channel.recover(connection)
  } catch (exception) {
    this.#diagnostics.emit('error', exception)
    connection.removeAllListeners()
    try { await connection.close() } catch {}
    if (this.#connection === connection) this.#connection = undefined
    return retry
  }

  this.#recovery.resolve()
  this.#recovery = new Promex()
}
```

Two wins:

1. Channel recovery uses a local `connection` reference, so a concurrent
   `#close` can't swap it out mid-loop.
2. Concurrent `open()` calls converge on a single retry loop.

### Test

Simulate two `close` events in quick succession (before the first recovery
finishes) and assert only one `amqp.connect` is *in progress* at any time and
the final state has exactly one live connection.

---

## Problem 6 — Partial `Channel.recover()` leaves the channel wedged

### Symptom

If `recover()` throws between `await this.create()` and the final
`#recovery.resolve()`, the Channel has already:

- replaced `this.#channel` with a new one,
- reset lazy locks,
- possibly pushed new consumer tags,

but has **not**:

- rejected pending confirmations,
- unpaused `#paused`,
- resolved `#recovery`.

Every user operation currently parked on `#recovery` stays parked forever
unless a subsequent recover succeeds. Combined with Problem 1, this is the
mechanism by which single failures persist.

### Fix

Make `recover()` structurally transactional — always release waiters on
failure by rejecting `#recovery` (with a sentinel that `failsafe.#recover`
classifies as permanent, so callers see a real error instead of hanging):

```js
async recover (connection) {
  this.#recovering = true
  try {
    this.#connection = connection
    await this.create()
    lazy.reset(this)
    await recall(this)
    this.#unpause(INTERRUPTION)
    for (const confirmation of this.#confirmations) confirmation.reject(INTERRUPTION)
    await new Promise(resolve => setTimeout(resolve, 0))
    this.#recovery.resolve()
    this.#recovery = new Promex()
    this.#diagnostics.emit('recover')
  } catch (exception) {
    // release everyone parked on #recovery; they will propagate the error
    this.#unpause(exception)
    for (const confirmation of this.#confirmations) confirmation.reject(exception)
    this.#recovery.reject(exception)
    this.#recovery = new Promex()
    throw exception
  } finally {
    this.#recovering = false
  }
}
```

Combined with Problem 2's fix, the Connection retry loop will catch this,
close the broken connection, and retry — instead of wedging callers.

### Test

Force `create()` to throw, call `recover()`, assert that a previously
`await`-ing `send()` rejects (rather than hanging) with the propagated
exception.

---

## Problem 7 — No liveness/heartbeat watchdog

### Symptom (optional but recommended)

amqplib's `Connection` relies on AMQP heartbeats and the underlying TCP
socket. In the half-open TCP case (NAT drop, cloud NLB idle timeout,
broker OOM without RST), neither `close` nor `error` may be emitted for a
long time — enough to look "stuck" even though the retry machinery is
healthy.

### Fix

Add a watchdog that forcibly destroys the underlying amqp `Connection` if no
progress has been observed within a configurable window. The simplest
implementation:

```js
// source/connection.js
#heartbeatTimer = null

#armWatchdog (connection, timeoutMs = 60_000) {
  const reset = () => {
    clearTimeout(this.#heartbeatTimer)
    this.#heartbeatTimer = setTimeout(() => {
      try { connection.connection?.stream?.destroy() } catch {}
    }, timeoutMs)
  }
  reset()
  connection.on('heartbeat', reset) // amqplib emits on each heartbeat
  connection.on('close', () => clearTimeout(this.#heartbeatTimer))
}
```

Call `#armWatchdog(this.#connection)` from `#open`. Any truly silent
connection will be destroyed, emitting `close`, and the normal retry loop
will take over.

### Test

Integration test (can be skipped by default) that blocks RabbitMQ traffic
with `iptables` / network namespaces in CI, asserting the library recovers
within watchdog + retry window.

---

## Rollout order

1. Problem 1 and Problem 2 together — they remove the deadlock and keep
   recovery inside the retry loop. These are the minimum fix for the hang.
2. Problem 3 — guard `#close`'s rejection.
3. Problem 6 — transactional `Channel.recover()`.
4. Problem 5 — serialise `open()` / local connection reference.
5. Problem 4 — broaden transient classifier.
6. Problem 7 — optional watchdog.

Each step is independently deployable and testable.
