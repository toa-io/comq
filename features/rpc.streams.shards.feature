Feature: Reply streams over shards

  Background:
    Given an active sharded connection
    And heartbeat interval is set to 100ms
    And idle timeout is set to 150ms

  Scenario: Requesting a stream using sharded connection
    Given a generator replying `get_numbers` queue:
      """
      function * ({ amount }) {
        for (let i = 0; i < amount; i++) yield i
      }
      """
    When the consumer requests a stream with the following request to the `get_numbers` queue:
      """yaml
      amount: 5
      """
    Then the consumer receives the stream:
      """yaml
      [0, 1, 2, 3, 4]
      """

  Scenario: Broker crashes while fetching a stream
    Given a number generator with 90ms increasing delay replying `get_numbers` queue
    When the consumer requests a stream with request to the `get_numbers` queue
    And the consumer receives the stream
    And after 300ms
    And the broker has crashed
    And the broker is up
    Then the consumer interrupts the stream
    And the consumer has received the stream containing:
      """yaml
      [0, 1, 2, 3, 4, 5, 6]
      """
    And after 1000ms
    And the generator is destroyed
