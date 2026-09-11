Feature: Request timeout

  A caller may say how long it waits for a reply. A request nobody took by then is dropped by the
  broker; one already taken is still processed, and its reply is discarded.

  Background:
    Given an active connection to the broker

  Scenario: A caller stops waiting at its timeout
    Given a producer replying `slow` queue in 1000ms
    When the consumer sends a request to the `slow` queue with a 200ms timeout
    Then the consumer stops waiting

  Scenario: A request nobody took in time is never processed
    When the consumer sends a request to the `later` queue with a 200ms timeout
    Then the consumer stops waiting
    When after 300ms
    And a producer counting requests to the `later` queue
    Then the producer receives nothing
