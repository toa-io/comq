Feature: Sharded Connection

  Scenario: Establishing sharded connection
    Given an active sharded connection

  Scenario: Connecting and waiting for 'open' event
    Given the connection to both shards is established

  Scenario: Connecting while a shard is down
    Given one of the brokers has crashed
    When I attempt to establish sharded connection
    Then the connection is established
    Then the broker is up

  Scenario: Sending a request to a sharded connection while one broker is down
    Given one of the brokers has crashed
    And an active sharded connection
    And a producer replying `add_numbers` queue
    When the consumer sends a request to the `add_numbers` queue
    Then the consumer receives the reply
    Then the broker is up

  Scenario: Publishing an event to a sharded connection missing one broker
    Given the connection to both shards is established
    And events are exclusively consumed from the `numbers_added` exchange
    And one of the brokers has crashed
    When an event is emitted to the `numbers_added` exchange
    Then the event is received
    Then the broker is up

  Scenario: Shard crashes while sending requests
    Given the connection to both shards is established
    And a producer replying `flood` queue
    And I'm sending 1kB requests to the `flood` queue at 100Hz
    When one of the brokers has crashed
    Then no exceptions are thrown
    And all replies have been received
    Then the broker is up

  Scenario: Shard crashes while publishing events
    Given the connection to both shards is established
    And I'm publishing 1kB events to the `flood` queue at 100Hz
    When one of the brokers has crashed
    Then no exceptions are thrown
    And all events have been received
    Then the broker is up

  Scenario: Sealing sharded connection while one broker is down
    Given the connection to both shards is established
    And a producer replying `echo` queue
    And one of the brokers has crashed
    And the connection has started sealing
    When the consumer sends a request to the `echo` queue
    And the broker is up
    Then the connection is sealed
    And the consumer does not receive the reply

  Scenario: Connecting with wrong credentials
    When I attempt to establish a sharded connection as "someone" with password "whatever"
    Then an exception is thrown: "Handshake terminated by server: 403 (ACCESS-REFUSED)"
