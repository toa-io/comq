Feature: Sharded Connection

  Scenario: Establishing sharded connection
    When I attempt to establish sharded connection
    Then the connection is established

  Scenario: Connecting while a shard is down
    Given one of the brokers has crashed
    When I attempt to establish sharded connection
    Then the connection is established
    Then the broker is up

  Scenario: Sending a request to a sharded connection missing one broker
    Given one broker has crashed
    And an active sharded connection
    And a producer replying `add_numbers` queue
    When the consumer sends a request to the `add_numbers` queue
    Then the consumer receives the reply
    Then the crashed broker is restored

  Scenario: Publishing an event to a sharded connection missing one broker
    Given one broker has crashed
    And an active sharded connection
    And events are exclusively consumed from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange
    Then the event is received
    Then the crashed broker is restored

  Scenario: Shard crashes while sending requests
    Given the connection to both shards is established
    And I'm sending 1kB requests to the `flood` queue at 500Hz for 1 second
    When one broker has crashed
    Then no exceptions are thrown
    And 500 replies have been received
    Then the crashed broker is restored

  Scenario: Shard crashes while publishing events
    Given the connection to both shards is established
    And I'm publishing 1kB events to the `flood` queue at 500Hz for 1 second
    When one broker has crashed
    Then no exceptions are thrown
    And 500 events have been received
    Then the crashed broker is restored

  Scenario: Connecting with wrong credentials
    When I attempt to establish sharded connection as "someone" with password "whatever"
    Then an exception is thrown: "Handshake terminated by server: 403 (ACCESS-REFUSED)"
