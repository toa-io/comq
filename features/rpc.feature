Feature: Request-reply (RPC)

  Background:
    Given an active connection to the broker

  Scenario: Sending request and getting reply
    Given function replying `add_numbers` queue:
      """
      ({ a, b }) => { return a + b }
      """
    When the consumer sends the following request to the `add_numbers` queue:
      """yaml
      a: 1
      b: 2
      """
    Then the consumer receives the reply:
      """yaml
      3
      """

  Scenario: Getting `null` reply
    Given function replying `add_numbers` queue:
      """
      () => { return null }
      """
    When the consumer sends the following request to the `add_numbers` queue:
      """yaml
      """
    Then the consumer receives the reply:
      """yaml
      null
      """

  Scenario: Streaming requests
    Given a producer replying `ping` queue
    When the consumer sends 1k requests to the `ping` queue as a stream
    Then the consumer receives 1k replies as a stream
