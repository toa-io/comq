@heavy
Feature: Calls under a key across failures

  A holder that loses its connection holds its key again once the connection is restored, and a
  caller's timeout ends its wait whatever the broker is doing.

  Scenario: A holder holds its key again after the broker restarts
    Given an active connection to the broker
    And a holder on another connection answering `echo` under the `a` key
    When the broker has crashed
    And the broker is up
    Then a call to `echo` under the `a` key is answered within 60 seconds

  Scenario: A holder holds its key again once the broker lets its silent connection go

    The holder reconnects while the broker still holds the connection that went silent, and with
    it the key. The holder finds the key taken until the broker lets that connection go, and
    claims it then.

    Given watchdog interval is set to 2000ms with 60s AMQP heartbeat
    And a network that can go silent
    And an active connection to the broker
    And a holder answering `echo` under the `a` key:
      """
      (payload) => payload
      """
    When the network goes silent
    Then the connection is lost within 10 seconds
    And the holder finds its key taken while the broker holds the silent connection
    When the silent connection is let go
    Then a call to `echo` under the `a` key from another connection is answered within 60 seconds

  Scenario: A call in flight when the broker crashes ends
    Given an active connection to the broker
    And a holder on another connection answering `slow` under the `a` key in 2000ms
    When the consumer calls `slow` under the `a` key
    And after 200ms
    And the broker has crashed
    And the broker is up
    Then the call ends

  Scenario: A caller stops waiting for a request at its timeout while the broker is down
    Given an active connection to the broker
    And a producer replying `echo` queue
    When the broker has crashed
    And the consumer sends a request to the `echo` queue with a 1000ms timeout
    Then the consumer stops waiting within 5 seconds

  Scenario: A caller stops waiting for a call at its timeout while the broker is down
    Given an active connection to the broker
    And a holder on another connection answering `echo` under the `a` key
    When the broker has crashed
    And the consumer calls `echo` under the `a` key with a 1000ms timeout
    Then the consumer stops waiting within 5 seconds

  Scenario: A request re-sent after the broker restarts expires at its caller's deadline

    The request is lost with the broker and sent again once the connection is restored, carrying
    the time its caller has left.

    Given an active connection to the broker
    When the consumer sends a request to the `resent` queue with a 30000ms timeout
    And after 200ms
    And the broker has crashed
    And the broker is up
    Then the consumer stops waiting within 40 seconds
    When a producer counting requests to the `resent` queue
    Then the producer receives nothing

  Scenario: A call reaches its holder while one of the brokers is down
    Given an active sharded connection
    And a holder on another connection answering `echo` under the `a` key
    When one of the brokers has crashed
    And the consumer calls `echo` under the `a` key 20 times
    Then every call is answered
