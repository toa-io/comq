# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

ComQ is a Node.js communication library over AMQP (RabbitMQ). It provides RPC, pub/sub, task queues, pipelines, and sharded connections.

### Services

| Service | Port | Credentials |
|---------|------|-------------|
| RabbitMQ 0 | AMQP: 5673, Management: 15673 | developer / secret |
| RabbitMQ 1 | AMQP: 5674, Management: 15674 | developer / secret |

Container names: `comq-rmq-0`, `comq-rmq-1`.

### Starting RabbitMQ

Docker in this VM requires extra setup due to nested container cgroup constraints. Use `--cgroup-parent=""` when running containers:

```bash
# Start Docker daemon (if not running)
sudo dockerd --exec-opt native.cgroupdriver=cgroupfs &
sudo chmod 666 /var/run/docker.sock

# Start RabbitMQ (don't use docker compose - resource limits trigger cgroup errors)
docker run -d --name comq-rmq-0 --cgroup-parent="" \
  -p 5673:5672 -p 15673:15672 \
  -e RABBITMQ_DEFAULT_USER=developer -e RABBITMQ_DEFAULT_PASS=secret \
  rabbitmq:3.10.0-management

docker run -d --name comq-rmq-1 --cgroup-parent="" \
  -p 5674:5672 -p 15674:15672 \
  -e RABBITMQ_DEFAULT_USER=developer -e RABBITMQ_DEFAULT_PASS=secret \
  rabbitmq:3.10.0-management
```

**Important**: `docker compose up` fails in this environment because the `deploy.resources.limits.memory` setting requires working cgroupv2 memory controller, which is unavailable in the nested container setup.

### Commands

- `npm test` — runs `standard` (lint) + `jest` (300 unit tests, no RabbitMQ required)
- `npm run features` — runs all Cucumber feature tests (requires both RabbitMQ instances)
- `npm run lint` — runs `standard --fix --verbose | snazzy`

### Testing Notes

- Unit tests (`jest`) use mocks and do NOT require running RabbitMQ.
- Feature tests (`cucumber-js`) require both RabbitMQ instances to be healthy.
- Recovery/connection tests (in `features/connection.feature`, `features/recovery.feature`, `features/shards.feature`) stop/kill Docker containers and take 5-15 minutes to complete.
- The backpressure test (`features/backpressure.feature`) is timing-sensitive and may fail in resource-constrained environments.
- To run only fast feature tests (no Docker stop/start): `npx cucumber-js --fail-fast -t 'not @manual' features/events.feature features/rpc.feature features/tasks.feature features/singleton.feature features/properties.feature features/tasks.shards.feature`
