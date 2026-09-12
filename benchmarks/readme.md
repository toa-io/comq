# Benchmarks

What one request costs the peer that answers it: the CPU it spends, the socket writes it makes,
and what the caller waits.

```shell
$ docker compose up -d
$ npm run benchmark
```

The peer runs in a process of its own — that is where its CPU is read from — and answers an echo
of a small object over `request`/`reply` on the broker `docker-compose.yaml` starts.

## What it reports

Two tables, because the two say different things.

**At a fixed rate** sends what a rate calls for and does not wait for the answers, which is how
traffic arrives. A rate below what the peer can serve is the honest place to read latency.

**With requests in flight** keeps a fixed number of them outstanding, which is how a queue of
callers behaves, and at a high enough number it is where the peer saturates: the rate column is
then what the peer can serve, and the CPU column is what one message costs it there.

Each row carries:

| column | what it is |
| --- | --- |
| `messages/s` | answered in the window, over its length |
| `CPU µs` | user and system time of the answering process, per message |
| `writes`, `writev` | socket write calls of the answering process, per message |
| `p50`, `p99` | what the caller waited, milliseconds |

`writes` and `writev` are the mechanism, not the outcome: a message the library writes as its own
syscall costs more than one written together with its neighbours.

## Reading a result

A number here means something only beside another number from the same machine. Run it on the
revision you are changing, then on your change, and compare the columns; a difference under about
5% between two rounds of the same revision is what this machine's noise looks like.

Both rounds are printed rather than averaged, so a run that drifted is visible as a run that
drifted.

## Options

| option | default | what it does |
| --- | --- | --- |
| `--rates` | `1000,5000,20000,40000` | messages a second for the fixed-rate table |
| `--concurrency` | `1,8,64,256` | requests in flight for the second table |
| `--messages` | `20000` | messages per window, in flight mode |
| `--seconds` | `6` | length of a window, fixed-rate mode |
| `--rounds` | `2` | how many times the whole matrix is measured |

`COMQ_BENCHMARK_URL` points the run at another broker.

```shell
$ npm run benchmark -- --rates 5000 --concurrency 64 --rounds 3
```

## What it does not measure

Streams, confirms, sharded or singleton connections, and recovery. It measures the path a request
and its reply take, which is the one every other path is built on.
