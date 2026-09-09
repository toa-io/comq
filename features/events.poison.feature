Feature: Poison events

  A message whose consumer throws is retried a few times and then kept, and the
  consumers around it go on working.

  Background:
    Given an active connection to the broker

  Scenario: A poison event is retried and then parked

    Six deliveries: the first, then five retries. The counter is the `x-comq-attempt`
    header, which the first delivery does not carry.

    Given that events from the `poison_retried` exchange are causing exceptions
    When an event is emitted to the `poison_retried` exchange
    Then the event is attempted 6 times
    And the message is parked
    And the parked message is kept, and says it came from the `poison_retried` exchange

  Scenario: A poison event does not stop the other consumers

    The events channel is shared by every consumption in the process, so a
    failure that sealed it would take this second consumer down with it.

    Given that events from the `poison_isolated` exchange are causing exceptions
    And that `witness` is consuming events from the `poison_witness` exchange
    When an event is emitted to the `poison_isolated` exchange
    And after 300ms
    And an event is emitted to the `poison_witness` exchange
    Then `witness` receives the event

  Scenario: A retried event is not redelivered to the other consumers of its exchange

    The exchange is a fanout: republishing the retry to it rather than to the
    retry queue would hand the message to every subscriber again, once per attempt.

    Given that events from the `poison_open` exchange are causing exceptions
    And that `bystander` is consuming events from the `poison_open` exchange
    When an event is emitted to the `poison_open` exchange
    And after 1000ms
    Then `bystander` has received 1 event
