Feature: Calls under a key over a sharded connection

  A call is published to one shard, and a shard where nobody holds the key returns it: it is
  published on the next one, and refused once every shard has returned it.

  Background:
    Given an active sharded connection

  Scenario: Answered by a holder on one broker only
    Given a holder connected to broker 0 answering `echo` under the `a` key
    When the consumer calls `echo` under the `a` key 20 times
    Then every call is answered

  Scenario: Refused when nobody holds the key on any broker
    Given a holder connected to broker 0 answering `echo` under the `a` key
    When the consumer calls `echo` under the `b` key
    Then the call is refused as unroutable
