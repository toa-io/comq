Feature: Reply streams

  Background:
    Given an active connection to the broker
    And heartbeat interval is set to 100ms
    And idle timeout is set to 150ms

  Scenario: Fetching a stream
    Given a generator replying `get_numbers` queue:
      """
      function * ({ amount }) {
        for (let i = 0; i < amount; i++) yield i
      }
      """
    When the consumer fetches a stream with the following request to the `get_numbers` queue:
      """yaml
      amount: 5
      """
    Then the consumer receives the stream:
      """yaml
      [0, 1, 2, 3, 4]
      """

  Scenario: Interrupting a stream
    Given a number generator with 20ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    And the consumer interrupts the stream after 3 replies
    # RabbitMQ takes some time to delete the queue
    And after 100ms
    Then the generator is destroyed

  Scenario: Reply stream idle timeout
    Given heartbeat interval is set to 300ms
    And a number generator with 120ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    Then the consumer receives the stream:
      """yaml
      [0, 1, 3]
      """
    And after 1000ms
    Then the generator is destroyed

  Scenario: Reply stream heartbeat
    # delay will exceed the idle timeout on the 3rd reply
    Given a number generator with 90ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    Then the consumer interrupts the stream after 5 replies
    And after 200ms
    Then the generator is destroyed
