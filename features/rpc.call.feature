Feature: Calls under a key

  A call reaches the one connection holding its key. A call under a key nobody holds is refused
  at once, and a holder that stops withdraws its key before it finishes what it holds.

  Background:
    Given an active connection to the broker

  Scenario: Answered by the holder of the key
    Given a holder answering `sums` under the `a` key:
      """
      ({ a, b }) => a + b
      """
    When the consumer calls `sums` under the `a` key with:
      """yaml
      a: 1
      b: 2
      """
    Then the consumer receives the reply:
      """yaml
      3
      """

  Scenario: Answered by the holder of that key only
    Given a holder answering `names` under the `a` key:
      """
      () => 'a'
      """
    And a holder answering `names` under the `b` key:
      """
      () => 'b'
      """
    When the consumer calls `names` under the `b` key
    Then the consumer receives the reply:
      """yaml
      b
      """

  Scenario: Refused when nobody holds the key
    Given a holder answering `names` under the `a` key:
      """
      () => 'a'
      """
    When the consumer calls `names` under the `c` key
    Then the call is refused as unroutable

  Scenario: A sealed holder answers what it holds and refuses what follows
    Given a holder on another connection answering `slow` under the `a` key in 500ms
    When the consumer calls `slow` under the `a` key
    And after 100ms
    And the holder is sealed
    Then the consumer receives the reply
    When the consumer calls `slow` under the `a` key
    Then the call is refused as unroutable

  Scenario: A second holder waits for the key
    Given a holder on another connection answering `echo` under the `a` key
    When a second holder on another connection holds `echo` under the `a` key
    Then the second holder waits for the key
    When the first holder disconnects
    Then the second holder holds the key
    When the consumer calls `echo` under the `a` key
    Then the consumer receives the reply

  Scenario: A caller stops waiting for a holder that is gone
    Given a holder never answering `void` under the `a` key
    When the consumer calls `void` under the `a` key with a 1000ms timeout
    And after 100ms
    And the silent holder's connection is lost
    Then the consumer stops waiting
