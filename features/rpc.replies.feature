Feature: Reply queues

  A connection consumes its replies from one queue, whatever it sends requests to. The
  reply is found by its correlation identifier, which is unique across processes, so the
  queue does not have to name what was called.

  Scenario: One reply queue however many queues are requested

    Given an active connection to the broker
    And a producer replying `replies_alpha` queue
    And a producer replying `replies_beta` queue
    When the consumer sends a request to the `replies_alpha` queue
    Then the consumer receives the reply
    When the consumer sends a request to the `replies_beta` queue
    Then the consumer receives the reply
    And the broker holds 1 reply queue

  Scenario: One reply queue per shard

    A shard is a broker of its own, and a request published to one is answered on it.

    Given an active sharded connection
    And a producer replying `replies_sharded` queue
    When the consumer sends 10 requests to the `replies_sharded` queue
    Then all replies have been received
    And each broker holds 1 reply queue
