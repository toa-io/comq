Feature: Channel exhaustion

  A connection allocates channels from a range the broker negotiates, and once the range
  is spent there is nothing a reconnection can do about it. The refusal is reported and
  passed on rather than retried, so that whoever asked for a channel is told instead of
  waiting for a recovery that is not coming.

  Scenario: Reporting a connection with no channel left to allocate
    Given the AMQP channel limit is set to 1
    And an active connection to the broker
    When emitting an event to the `exhaustion` exchange is attempted
    And replying the `echo` queue is attempted
    Then the exception is thrown: "No channels left to allocate"
    And the `exhausted` event is emitted

  Scenario: Declaring a queue for Requests with no channel left to declare it on

    A queue for Requests is declared on a channel of its own, which is given back at once. A
    connection that has none to spare says so, as it does of any other channel.

    Given the AMQP channel limit is set to 2
    And an active connection to the broker
    When replying the `echo` queue is attempted
    Then the exception is thrown: "No channels left to allocate"
