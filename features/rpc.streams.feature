Feature: Reply streams

  Background:
    Given an active connection to the broker
    And heartbeat interval is set to 100ms
    And idle timeout is set to 150ms

  Scenario: Fetching a stream
    Given function replying `get_numbers` queue:
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

  Scenario: Fetching streams concurrently
    Given a number generator with 10ms increasing delay replying `get_numbers` queue
    When the consumer0 fetches a stream with request to the `get_numbers` queue
    And the consumer0 receives the stream
    And the consumer1 fetches a stream with request to the `get_numbers` queue
    And the consumer1 receives the stream
    And after 300ms
    Then the consumer0 has received the stream:
      """yaml
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      """
    And the consumer1 has received the stream:
      """yaml
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
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
    And a number generator with 100ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    Then the consumer receives the stream:
      """yaml
      [0, 1, 3]
      """
    And after 500ms
    Then the generator is destroyed

  Scenario: Reply stream heartbeat
    # delay will exceed the idle timeout on the 3rd reply
    Given a number generator with 90ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    Then the consumer interrupts the stream after 5 replies
    And after 200ms
    Then the generator is destroyed

  Scenario: Broker crashes while streaming reply
    Given a number generator with 90ms increasing delay replying `get_numbers` queue
    When the consumer fetches a stream with request to the `get_numbers` queue
    Then the consumer receives the stream
    And after 300ms
    Then the broker has crashed
    # idle timeout
    Then after 150ms
    Then the consumer has received the stream:
      """yaml
      [0, 1, 2]
      """
    Then after 200ms
    Then the broker is up
    And the generator is destroyed
