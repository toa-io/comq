@heavy
Feature: Re-sending the requests a lost shard held

  A Request is re-sent when the shard it went through is lost, since its Reply may be lost with it.
  One that went through a shard that stays is answered through that shard, and is never re-sent
  because another one was lost: a Request is not assumed to be idempotent.

  Each scenario first takes one broker away from the consumer, so that the Requests it sends go
  through the other one, and gives the broker back before losing one of them again.

  Background:
    Given 1s AMQP heartbeat
    And a network that can go silent
    And an active sharded connection
    And a producer replying `echo` queue
    # the consumer's channels exist on both brokers before one of them is taken away
    And the consumer sends a request to the `echo` queue
    And the consumer receives the reply
    And a producer on another connection counting the requests to the `numbered` queue, answering when told

  Scenario: Requests through the broker that stays are not re-sent when the other one is lost
    Given the consumer's connection to broker 1 is cut
    When the consumer sends 10 numbered requests to the `numbered` queue
    And the consumer's connection to broker 1 is restored
    And the consumer's connection to broker 1 is cut
    And the producer answers
    Then every numbered request is answered within 10 seconds
    And every numbered request has been executed once

  Scenario: Replies to the requests through the broker that stays are not lost with the other one
    Given the consumer's connection to broker 1 is cut
    When the consumer sends 10 numbered requests to the `numbered` queue
    And the consumer's connection to broker 1 is restored
    And the consumer's network to broker 1 goes silent
    And the producer answers
    Then every numbered request is answered within 15 seconds
    And every numbered request has been executed once

  Scenario: Requests through the broker that is lost are re-sent and answered
    Given the consumer's connection to broker 0 is cut
    When the consumer sends 10 numbered requests to the `numbered` queue
    And the consumer's connection to broker 0 is restored
    And the consumer's network to broker 1 goes silent
    And the producer answers
    Then every numbered request is answered within 15 seconds
    And every numbered request has been executed twice
