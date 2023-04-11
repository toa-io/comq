Feature: Message properties

  Background:
    Given an active connection to the broker

  Scenario: Sending and receiving an event with properties
    Given that `checker` is consuming events from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange with properties:
      """yaml
      foo: bar
      """
    Then `checker` receives the event with properties:
      """yaml
      contentType: application/msgpack # standard properties are available
      foo: bar
      """
