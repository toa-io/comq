Feature: The parking queue

  What a consumer could not process is kept in one queue, `comq.parked`, whatever it was
  consumed from. The message says where it came from, so the queue does not have to.

  Background:
    Given an active connection to the broker

  Scenario: Messages parked from two queues are kept in one

    A queue per source would repeat what every parked message already carries, and
    would stay on the broker for as long as the broker does.

    Given that events from the `parking_left` exchange are causing exceptions
    And that events from the `parking_right` exchange are causing exceptions
    When an event is emitted to the `parking_left` exchange
    And an event is emitted to the `parking_right` exchange
    Then a message parked from the `parking_left` exchange is in the parking queue
    And a message parked from the `parking_right` exchange is in the parking queue

  Scenario: A message parked from a groupless subscription outlives its connection

    A groupless subscriber consumes a queue of its own that the broker removes with the
    connection. What it could not process is not ephemeral: it is waiting for a person,
    and there is nobody left to tell.

    Given that groupless events from the `parking_ephemeral` exchange are causing exceptions
    When an event is emitted to the `parking_ephemeral` exchange
    And the message is parked
    And the connection is closed
    And an active connection to the broker
    Then a message parked from the `parking_ephemeral` exchange is in the parking queue
