Feature: Abandoning the Replies a close is waiting for

  A consumer callback may call out while it runs, and a close waits for every callback to return.
  Where the answer that callback waits for is the one thing going away with the close, the two
  wait for each other. Abandoning ends that wait.

  Background:
    Given an active connection to the broker

  Scenario: Abandoning lets a close finish
    Given a producer replying `upstream` queue by requesting the `downstream` queue
    When the consumer sends a request to the `upstream` queue
    And the producer is handling the request
    And the connection abandons its replies
    Then the connection closes within 1000ms
    And the producer was told its reply is abandoned
    And the consumer was told its own reply is abandoned

  Scenario: A close already under way is told to stop waiting
    Given a producer replying `upstream` queue by requesting the `downstream` queue
    When the consumer sends a request to the `upstream` queue
    And the producer is handling the request
    And the connection has started closing
    And the connection abandons its replies
    Then the connection closes within 1000ms

  Scenario: A Request made once the Replies are abandoned is refused
    Given a producer replying `upstream` queue by requesting the `downstream` queue
    When the consumer sends a request to the `upstream` queue
    And the producer is handling the request
    And the connection abandons its replies
    Then a request to the `downstream` queue is refused as abandoned
