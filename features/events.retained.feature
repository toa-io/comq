Feature: Retained queues

  A queue a producer declares for whoever consumes it later: what is routed to it before anything
  consumes it is held rather than returned.

  Background:
    Given an active connection to the broker

  Scenario: Holding what is routed before anything consumes
    Given `ledger` is retained on the `journal` exchange under the `posted` key
    When a message is routed to the `journal` exchange under the `posted` key
    And `ledger` is bound to the `journal` exchange under the `posted` key
    Then `ledger` receives the event

  Scenario: Declaring the queue with arguments
    Given `graveyard` is retained on the `buried` exchange under the `posted` key
    And `register` is retained on the `journal` exchange under the `posted` key with arguments:
      """yaml
      x-max-length: 1
      x-dead-letter-exchange: buried
      """
    When a message is routed to the `journal` exchange under the `posted` key
    And another message is routed to the `journal` exchange under the `posted` key
    And `graveyard` is bound to the `buried` exchange under the `posted` key
    Then `graveyard` receives the first event

  Scenario: Retaining over a sharded connection
    Given an active sharded connection
    And `archive` is retained on the `journal` exchange under the `filed` key
    When a message is routed to the `journal` exchange under the `filed` key
    And `archive` is bound to the `journal` exchange under the `filed` key
    Then `archive` receives the event
