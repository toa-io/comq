Feature: Poison events

  Background:
    Given an active connection to the broker

  @manual
  Scenario: Sending a poison event

    This scenario will cause an exception, run it once.

    Given that events from the `poison` exchange are causing exceptions
    Then an event is emitted to the `poison` exchange
    And after 100ms

  @manual
  Scenario: Consuming poison events

    After the poison event is sent, run this scenario five times
    and verify that the poison event was discarded.

    Given that events from the `poison` exchange are causing exceptions
    And after 100ms
