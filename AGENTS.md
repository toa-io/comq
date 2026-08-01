# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

ComQ is a Node.js communication library over AMQP (RabbitMQ). It provides RPC, pub/sub, task queues, pipelines, and sharded connections.

### Services

Feature tests start two RabbitMQ instances automatically via Testcontainers (`features/steps/brokers.js`). Credentials: `developer` / `secret`. AMQP ports are assigned dynamically on the host.

### Docker

Feature tests require a running Docker daemon. In nested container environments, start Docker with:

```bash
sudo dockerd --exec-opt native.cgroupdriver=cgroupfs &
sudo chmod 666 /var/run/docker.sock
```

Do not use `docker compose up` for feature tests — Testcontainers manages broker lifecycle. `docker compose` may fail here because `deploy.resources.limits.memory` requires cgroupv2 memory limits that are unavailable in nested setups.

### Commands

- `npm test` — runs `standard` (lint) + `jest` (300 unit tests, no RabbitMQ required)
- `npm run features` — runs all Cucumber feature tests (starts RabbitMQ via Testcontainers)
- `npm run lint` — runs `standard --fix --verbose | snazzy`

### Testing Notes

- Unit tests (`jest`) use mocks and do NOT require running RabbitMQ.
- Feature tests (`cucumber-js`) start brokers in `BeforeAll` and stop them in `AfterAll`.
- Recovery/connection tests (in `features/connection.feature`, `features/recovery.feature`, `features/shards.feature`) stop/kill broker containers and take 5-15 minutes to complete.
- To run only fast feature tests (no broker stop/start): `npx cucumber-js --fail-fast -t 'not @manual' features/events.feature features/rpc.feature features/tasks.feature features/singleton.feature features/properties.feature features/tasks.shards.feature`
