Feature: Routed events

  An exchange that routes by key, where an event exchange fans out: a message reaches the
  queues bound under the key it was published with, and none of the others.

  Background:
    Given an active connection to the broker

  Scenario: Receiving an event by its routing key
    Given that `orders` is bound to the `records` exchange under the `placed` key
    When a message is routed to the `records` exchange under the `placed` key
    Then `orders` receives the event

  Scenario: Not receiving an event bound under another key
    Given that `orders` is bound to the `records` exchange under the `placed` key
    And `customers` is bound to the `records` exchange under the `shipped` key
    When a message is routed to the `records` exchange under the `placed` key
    Then `orders` receives the event
    And `customers` receives nothing
