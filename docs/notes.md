# Notes

## "At least once"

RabbitMQ delivers a message **before** it has been written to disk, therefore provides "at least
once" delivery guarantee. Considering that, system using communications over AMQP must be
idempotent.

## Cause-Effect Confirmation Lag

Let's consider a scenario where an application receives messages ("causes") from a queue, processes
them, and then publishes expected messages ("effects") to another queue. An example of this is a
Producer that consumes Requests and produces Replies. The rate at which messages are consumed is
limited by a "prefetch count", which is the maximum number of concurrent Requests that can be
processed at the same time.

For simplicity, let's assume that the prefetch count is set to 1. After a "cause" message is
consumed, the next message in the queue is held until the current message is acknowledged ("ack").
The current message is acknowledged once the Producer function is completed, which means that an
"effect" message has been successfully published using the ConfirmChannel. This "effect" message is
considered to be published when a confirmation is received from the broker.

In summary, the next "cause" message will be consumed from the queue only after the "effect" message
publication has been confirmed. Due to the "at least once" effect, *there is a
delay between the moment when a Reply **is delivered** to the Consumer and the moment when the
next Request is consumed from the Request queue*.

<a href="https://miro.com/app/board/uXjVOoy0ImU=/?moveToWidget=3458764545934661005&cot=14">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="lag-dark.jpg">
<img alt="Confirmation Lag" width="640" src="lag-light.jpg">
</picture>
</a>

A lightweight Producer (one that produces responses quickly) can result in being "overloaded"
from the Consumer's perspective (that is, does not consume messages with an expected rate), even
though the Producer being idle while waiting for response publication confirmations.

## Flow Control Lock

When the [flow control mechanism](../readme.md#flow-control) is applied, an application that
consumes requests and sends other request will hit the prefetch limit of incoming messages and
become unresponsive until the issue is resolved.

When an application becomes unresponsive, it can cause a chain reaction that makes all of its
clients unresponsive, up to the system's *entry point* (which is typically the API Gateway).
Therefore, the flow control of a distributed system is managed by its entry point, giving developers
the choice to either stop accepting new requests (e.g., by replying with
a [`429`](https://www.rfc-editor.org/rfc/rfc6585.html#section-4) HTTP status code for an API), or to
continue sending new requests ignoring back pressure mechanism, risking a potential RabbitMQ crash
due to running out of memory.

> ComQ does not currently provide an option to ignore back pressure mechanism.
