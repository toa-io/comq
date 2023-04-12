Feature: Message properties

  Background:
    Given an active connection to the broker

  Scenario: Sending and receiving an event with headers
    Given that `checker` is consuming events from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange with properties:
      """yaml
      headers:
        foo: bar
      """
    Then `checker` receives the event with properties:
      """yaml
      contentType: application/octet-stream # standard properties are available
      headers:
        foo: bar
      """

  Scenario: Sending and receiving an event with AMQP properties
    Given that `checker` is consuming events from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange with properties:
      """yaml
      appId: test
      """
    Then `checker` receives the event with properties:
      """yaml
      appId: test
      """
