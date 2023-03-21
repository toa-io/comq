Feature: Connection Tolerance

  Scenario: Connect
    Given an active connection to the broker

  Scenario: Connecting to a broker before it was started
    Given the broker is down
    When I attempt to connect to the broker for 0.2 seconds
    Then the connection is not established
    And no exceptions are thrown
    When the broker is up
    Then the connection is established

  Scenario: Restoring connection after broker restart
    Given an active connection to the broker
    When the broker is down
    Then the connection is lost
    When the broker is up
    Then the connection is restored

  Scenario: Restoring connection after broker crash
    Given an active connection to the broker
    When the broker has crashed
    Then the connection is lost
    When the broker is up
    Then the connection is restored

  Scenario: Connecting with wrong credentials
    When I attempt to connect to the broker as "someone" with password "whatever"
    Then an exception is thrown: "Handshake terminated by server: 403 (ACCESS-REFUSED)"
