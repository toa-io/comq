Feature: Virtual shards

  The URLs of a sharded connection are names, of which several may stand for one broker.
  A connection is made to each broker, and the brokers are followed as the names move.

  Scenario: Names sharing a broker share a connection
    Given 4 names, half of them standing for each broker
    When I connect to the names
    Then 1 connection is open to each broker

  Scenario: Names given as a range
    Given 4 names, half of them standing for each broker
    When I connect to the range of the names
    Then 1 connection is open to each broker

  Scenario: Requests over the names of one broker
    Given 4 names standing for the first broker
    And an active connection to the names
    And a producer replying `virtual_one` queue
    When the consumer sends 20 requests to the `virtual_one` queue
    Then all replies have been received
    And 1 connection is open to the first broker
    And 0 connections are open to the second broker

  Scenario: A name moves to another broker
    Given 4 names standing for the first broker
    And an active connection to the names
    And a producer replying `virtual_moved` queue
    And tasks from the `virtual_moved_tasks` queue are being processed
    When half of the names move to the second broker
    Then the second broker has joined
    And 1 connection is open to each broker
    When the consumer sends 50 requests to the `virtual_moved` queue
    Then all replies have been received
    When a task is enqueued to the `virtual_moved_tasks` queue of the second broker by another connection
    Then the task is processed

  Scenario: A broker no name stands for is drained before it is left
    Given 4 names standing for the first broker
    And a broker lingers for 300ms
    And an active connection to the names
    And tasks from the `virtual_left_behind` queue are being processed
    And a producer replying `virtual_slow` queue in 2000ms
    When the consumer sends 5 requests to the `virtual_slow` queue
    And the names move to the second broker
    Then the second broker has joined
    And the first broker is retired
    When a task is enqueued to the `virtual_left_behind` queue of the first broker by another connection
    Then the task is processed
    When after 1000ms
    Then the first broker is not left
    And all replies have been received
    And the first broker is left
    And 0 connections are open to the first broker
    When the consumer sends 20 requests to the `virtual_slow` queue
    Then all replies have been received

  Scenario: Names observed while they are moving are not followed
    Given 4 names standing for the first broker
    And an active connection to the names
    When the names keep moving between the brokers for 1500ms
    And after 500ms
    Then no broker has joined or retired
    And 0 connections are open to the second broker

  Scenario: A broker that is out of reach is followed at once
    Given 4 names standing for the first broker
    And the names settle in 60000ms
    And an active connection to the names
    And a producer replying `virtual_followed` queue
    When the first broker is out of reach
    And the names move to the second broker
    Then the second broker has joined
    When the consumer sends 20 requests to the `virtual_followed` queue
    Then all replies have been received

  Scenario: A retiring broker that is named again is back
    Given 4 names standing for the first broker
    And a broker lingers for 5000ms
    And an active connection to the names
    And a producer replying `virtual_back` queue
    When the names move to the second broker
    Then the first broker is retired
    When the names move to the first broker
    Then the first broker has joined
    And the second broker is retired
    And the first broker is not left
    When the consumer sends 20 requests to the `virtual_back` queue
    Then all replies have been received
