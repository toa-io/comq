# Examples

To run the examples, please start RabbitMQ server with `docker compose up -d` in the package root.

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

## Reply streams

Run in two terminals:

```shell
$ node exampels/streams/producer
```

[source](streams/producer.js)

```shell
$ node exampels/streams/consumer
```

[source](streams/consumer.js)
