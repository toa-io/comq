Feature: Events

  Background:
    Given an active connection to the broker

  Scenario: Sending and receiving an event
    Given that `checker` is consuming events from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange
    Then `checker` receives the event

  Scenario: Receiving an event by two consumer groups
    Given that `first` is consuming events from the `numbers_added` exchange
    And `second` is consuming events from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange
    Then `first` receives the event
    And `second` receives the event

  Scenario: Receiving an event exclusively
    Given that events are exclusively consumed from the `numbers_added` exchange
    When an event is emitted to the `numbers_added` exchange
    Then the event is received
