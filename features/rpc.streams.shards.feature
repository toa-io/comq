Feature: Reply streams over shards

  Background:
    Given an active sharded connection

  Scenario: Fetching a stream using sharded connection
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
