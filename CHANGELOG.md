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
