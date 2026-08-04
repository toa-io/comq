Feature: Sharded subscriptions

  A subscription is only complete once every shard has it, otherwise a message
  published to a randomly picked shard has nowhere to be routed.

  Background:
    Given an active sharded connection

  Scenario: Events published right after subscribing
    Given events are exclusively consumed from the `numbers_added` exchange
    When a stream of 100 events is emitted to the `numbers_added` exchange
    Then 100 events have been received

  Scenario: Requesting streams repeatedly
    Given a generator replying `get_numbers` queue:
      """
      function * ({ amount }) {
        for (let i = 0; i < amount; i++) yield i
      }
      """
    When the consumer requests 20 streams with the following request to the `get_numbers` queue:
      """yaml
      amount: 5
      """
    Then every stream has been received
