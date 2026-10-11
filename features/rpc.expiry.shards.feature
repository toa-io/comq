Feature: Request queues that expire, over a sharded connection

  Background:
    Given Request queues expire in 1500ms
    And an active sharded connection

  Scenario: A queue is kept on the shard a Request waits on
    When the consumer sends a request to the `expiry_shard` queue
    And after 4000ms
    Given a producer on another connection replying `expiry_shard` queue
    Then the consumer receives the reply

  Scenario: A queue that was dropped is declared by the next Request
    Given a producer on another connection replying `expiry_shards` queue
    When the consumer sends a request to the `expiry_shards` queue
    Then the consumer receives the reply
    When that producer is gone
    And after 3000ms
    And the consumer sends a request to the `expiry_shards` queue
    And after 2500ms
    Given a producer on another connection replying `expiry_shards` queue
    Then the consumer receives the reply
