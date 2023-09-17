Feature: Reply streams

  Background:
    Given an active connection to the broker

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
    Given a number generator with 100ms delay replying `get_numbers` queue
    When the consumer fetches a stream with the following request to the `get_numbers` queue:
      """yaml
      amount: 5
      """
    And the consumer interrupts the stream after 3 replies
    And after 500ms
    Then the generator is destroyed
