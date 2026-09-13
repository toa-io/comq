Feature: Suspending consumption

  A connection may stop consuming and start again. Sealing is for good; this is not — what was
  registered is kept, the queues fill while nothing takes from them, and Requests are untouched:
  what a connection is answering it goes on answering.

  Background:
    Given an active connection to the broker

  Scenario: An Event published while suspended is consumed once it is not
    Given that `checker` is consuming events from the `suspending_events` exchange
    When the connection is suspended
    And an event is emitted to the `suspending_events` exchange
    Then `checker` receives nothing within 500ms
    When the connection is unsuspended
    Then `checker` receives the event within 5000ms

  Scenario: A Task sent while suspended is processed once it is not
    Given tasks from the `suspending_tasks` queue are being processed
    When the connection is suspended
    And a task is sent to the `suspending_tasks` queue
    Then no task is processed within 500ms
    When the connection is unsuspended
    Then the task is processed within 5000ms

  Scenario: Requests are answered while suspended
    Given function replying `suspending_add` queue:
      """
      ({ a, b }) => { return a + b }
      """
    When the connection is suspended
    And the consumer sends the following request to the `suspending_add` queue:
      """yaml
      a: 1
      b: 2
      """
    Then the consumer receives the reply:
      """yaml
      3
      """
