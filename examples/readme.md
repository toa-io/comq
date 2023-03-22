# Examples

To run examples please start RabbitMQ server with `docker compose up -d` in the package root.

> Try to run example first.

## RPC

Run in two terminals:

```shell
$ node exampels/rpc/producer
```

[source](rpc/producer.js)

```shell
$ node exampels/rpc/consumer
```

[source](rpc/consumer.js)

> Try to run consumer first.

## Events

Run in multiple terminals:

```shell
$ node examples/events/consumer A
```

```shell
$ node examples/events/consumer B
```

[source](events/consumer.js)

```shell
$ node examples/events/producer
```

[source](events/producer.js)

`A` and `B` are consumer groups.

> Try to run multiple instances with the same consumer group.
