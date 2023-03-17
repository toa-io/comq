Feature: Sharded Connection

  Background:
    Given the connection to both shards is established

  Scenario: Shard crashes while sending requests
    Given I'm sending 1kB requests to the `flood` queue at 500Hz for 1 second
    When one broker has crashed
    Then no exceptions are thrown
    And 500 replies have been received
    Then the crashed broker is restored

  Scenario: Shard crashes while publishing events
    Given I'm publishing 1kB events to the `flood` queue at 500Hz for 1 second
    When one broker has crashed
    Then no exceptions are thrown
    And 500 events have been received
    Then the crashed broker is restored
