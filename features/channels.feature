Feature: Channel exhaustion

  A connection allocates channels from a range the broker negotiates, and once the range
  is spent there is nothing a reconnection can do about it. The refusal is reported and
  passed on rather than retried, so that whoever asked for a channel is told instead of
  waiting for a recovery that is not coming.

  Scenario: Reporting a connection with no channel left to allocate
    Given the AMQP channel limit is set to 2
    And an active connection to the broker
    And a producer replying `echo` queue
    When emitting an event to the `exhaustion` exchange is attempted
    Then the exception is thrown: "No channels left to allocate"
    And the `exhausted` event is emitted
