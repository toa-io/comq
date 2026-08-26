## [0.15.6](https://github.com/toa-io/comq/compare/v0.15.5...v0.15.6) (2026-08-26)


### Bug Fixes

* do not report shards as lost on shutdown ([abbe0e8](https://github.com/toa-io/comq/commit/abbe0e8e1048509ff2c981b7aa33659c0829e821))
* do not report shards as lost on shutdown ([#248](https://github.com/toa-io/comq/issues/248)) ([b269a5c](https://github.com/toa-io/comq/commit/b269a5cc78d8ca74036290abec234a1e87056e9c))

## [0.15.5](https://github.com/toa-io/comq/compare/v0.15.4...v0.15.5) (2026-08-25)


### Bug Fixes

* recover from a lost connection reliably ([59b1fab](https://github.com/toa-io/comq/commit/59b1fab61d4f27ab6eb608693da6493b5b1f4ae5))
* recover from a lost connection reliably ([#247](https://github.com/toa-io/comq/issues/247)) ([e4701cf](https://github.com/toa-io/comq/commit/e4701cfa384d5451c15d0a6bf53c82ce1da91ac5))

## [0.15.4](https://github.com/toa-io/comq/compare/v0.15.3...v0.15.4) (2026-08-16)


### Bug Fixes

* remove request() timeout ([#246](https://github.com/toa-io/comq/issues/246)) ([d432388](https://github.com/toa-io/comq/commit/d4323889bcad867a870d0ed351b92098f6aad551))

## [0.15.3](https://github.com/toa-io/comq/compare/v0.15.2...v0.15.3) (2026-08-04)


### Bug Fixes

* re-send requests left unanswered by a lost shard ([c534a01](https://github.com/toa-io/comq/commit/c534a0136e5f0189cdb6976cd9cffb9a2ca5a148))
* re-send requests left unanswered by a lost shard ([#242](https://github.com/toa-io/comq/issues/242)) ([c821da8](https://github.com/toa-io/comq/commit/c821da895049bd78a907c6705477ebe74c160e1b))

## [0.15.2](https://github.com/toa-io/comq/compare/v0.15.1...v0.15.2) (2026-08-04)


### Bug Fixes

* report and recover undeliverable replies ([b2d2d0f](https://github.com/toa-io/comq/commit/b2d2d0f11d7714c2d32d3d85894fa78e2203f8c6))
* report and recover undeliverable replies ([#241](https://github.com/toa-io/comq/issues/241)) ([73e5592](https://github.com/toa-io/comq/commit/73e5592762634fbead29d825be68a3da3136729b))

## [0.15.1](https://github.com/toa-io/comq/compare/v0.15.0...v0.15.1) (2026-08-02)


### Bug Fixes

* skip end control when reply stream buffer overflows ([654e046](https://github.com/toa-io/comq/commit/654e046bdcbfbbbbbb789e5bb032bc16564221d1)), closes [#control](https://github.com/toa-io/comq/issues/control) [#reply](https://github.com/toa-io/comq/issues/reply)
* skip end control when reply stream buffer overflows ([#237](https://github.com/toa-io/comq/issues/237)) ([c34d87f](https://github.com/toa-io/comq/commit/c34d87f6d219ce6c8509d989117eadd55a33ca86))

# [0.15.0](https://github.com/toa-io/comq/compare/v0.14.0...v0.15.0) (2026-08-01)


### Bug Fixes

* avoid channel recover deadlock after broker restart ([8eeaf2e](https://github.com/toa-io/comq/commit/8eeaf2e12321be71b57913adb6a8fb04bd24d439)), closes [#recovery](https://github.com/toa-io/comq/issues/recovery)
* destroy half-open connections via socket idle watchdog ([9f7ed5f](https://github.com/toa-io/comq/commit/9f7ed5fe50e9ab1857547a6e908185b6b472162f))
* ignore close events from replaced AMQP connections ([c1070ab](https://github.com/toa-io/comq/commit/c1070abeca9eb30a1c0ed07925bc06e530c1d9ce))
* reconnect hang after broker restart ([#235](https://github.com/toa-io/comq/issues/235)) ([be07079](https://github.com/toa-io/comq/commit/be07079863194301d0279e2bdd551260196ce20a))
* retry transient network errors on initial connect ([c436a20](https://github.com/toa-io/comq/commit/c436a2017a2b52d102afa05bc694c9f22faf2065)), closes [#transient](https://github.com/toa-io/comq/issues/transient)
* tolerate empty YAML documents after js-yaml 5 bump ([0a05ecb](https://github.com/toa-io/comq/commit/0a05ecbf744822b3aa884382642ce51a93922dfc))


### Features

* allow request() to time out pending replies ([ac9e2bd](https://github.com/toa-io/comq/commit/ac9e2bd7eb0834d19d404c84f24548bd5475017f))
* tag container-manipulation features [@heavy](https://github.com/heavy) and add features:fast script ([c0f52ec](https://github.com/toa-io/comq/commit/c0f52ecf72c010e387e853b3daed6884c1cef474))

# [0.14.0](https://github.com/toa-io/comq/compare/v0.13.0...v0.14.0) (2026-05-24)


### Features

* **features:** manage RabbitMQ brokers with Testcontainers ([1d9ca59](https://github.com/toa-io/comq/commit/1d9ca591ff458c75caf87ab63224b15942ba7d07))
* **features:** use Testcontainers for RabbitMQ in Gherkin tests ([#219](https://github.com/toa-io/comq/issues/219)) ([a33e66b](https://github.com/toa-io/comq/commit/a33e66bfc357f0f089c728bc60c08f6f24b2c8d1))

# Changelog

All notable changes to this project are documented in this file by [semantic-release](https://github.com/semantic-release/semantic-release).
