Feature: Silent Connection Tolerance

  A connection that has gone silent is what a machine that woke from sleep is
  left with: the socket is open, neither the broker nor the operating system
  reports anything, and nothing but the watchdog tells it from an idle connection.

  Background:
    Given watchdog interval is set to 2000ms with 60s AMQP heartbeat
    And a network that can go silent

  Scenario: Restoring a connection that has gone silent
    Given an active connection to the broker
    And a producer replying `echo` queue
    When the network goes silent
    Then the connection is lost within 10 seconds
    When the consumer sends a request to the `echo` queue
    Then the consumer receives the reply

  Scenario: Restoring a sharded connection whose every shard has gone silent
    Given an active sharded connection
    And a producer replying `echo` queue
    When the network goes silent
    Then the connection is lost within 10 seconds
    When the consumer sends a request to the `echo` queue
    Then the consumer receives the reply

  Scenario: Answering a request sent as the connection goes silent
    Given an active connection to the broker
    And a producer replying `echo` queue
    When the consumer sends a request to the `echo` queue as the network goes silent
    Then the consumer receives the reply
    And the connection is lost within 10 seconds

  Scenario: Answering a request sent as every shard goes silent
    Given an active sharded connection
    And a producer replying `echo` queue
    When the consumer sends a request to the `echo` queue as the network goes silent
    Then the consumer receives the reply
    And the connection is lost within 10 seconds
