Feature: Sharded Connection

  Scenario: Establishing sharded connection
    Given an active sharded connection

  Scenario: Connecting while a shard is down
    Given one of the brokers has crashed
    When I attempt to establish sharded connection
    Then an exception is thrown: "ECONNREFUSED"
    Then the broker is up

  Scenario: Connecting with wrong credentials
    When I attempt to establish a sharded connection as "someone" with password "whatever"
    Then an exception is thrown: "Handshake terminated by server: 403 (ACCESS-REFUSED)"

  Scenario: Sending a request to a sharded connection while one broker is down
    Given an active sharded connection
    And one of the brokers has crashed
    And a producer replying `add_numbers` queue
    When the consumer sends a request to the `add_numbers` queue
    Then the consumer receives the reply
    Then the broker is up

  Scenario: Publishing an event to a sharded connection missing one broker
    Given an active sharded connection
    And events are exclusively consumed from the `numbers_added` exchange
    And one of the brokers has crashed
    When an event is emitted to the `numbers_added` exchange
    Then the event is received
    Then the broker is up

  Scenario: Shard crashes while sending requests
    Given an active sharded connection
    And a producer replying `flood` queue
    And I'm sending 1kB requests to the `flood` queue at 1kHz
    When one of the brokers has crashed
    Then no exceptions are thrown
    And all replies have been received
    Then the broker is up

  Scenario: Shard crashes while publishing events
    Given an active sharded connection
    And events are exclusively consumed from the `flood` exchange
    And I'm publishing 1kB events to the `flood` exchange at 100Hz
    When one of the brokers has crashed
    Then no exceptions are thrown
    And all events have been received
    Then the broker is up

  Scenario: Sealing sharded connection while one broker is down
    Given an active sharded connection
    And a producer replying `echo` queue
    And one of the brokers has crashed
    And the connection has started sealing
    When the consumer sends a request to the `echo` queue
    And the broker is up
    Then the connection is sealed
    And the consumer does not receive the reply
