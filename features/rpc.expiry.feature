Feature: Request queues that expire

  A Request queue is kept by the broker while somebody uses it: a producer that consumes it,
  or a consumer that is about to send a Request to it or is waiting for a Reply from it. A queue
  nobody has used for as long as it expires in is dropped, and is declared again by whoever
  uses it next.

  Background:
    Given Request queues expire in 1500ms
    And an active connection to the broker

  Scenario: A queue nobody uses is dropped
    Given a producer on another connection replying `expiry_abandoned` queue
    When the consumer sends a request to the `expiry_abandoned` queue
    Then the consumer receives the reply
    When that producer is gone
    Then the broker has the `expiry_abandoned` queue
    And the broker has no `expiry_abandoned` queue

  Scenario: A queue is kept while a Request waits in it

    Nobody consumes the queue, and nothing is sent to it but the one Request: it is the
    consumer waiting for the Reply that keeps it.

    When the consumer sends a request to the `expiry_awaited` queue
    And after 4000ms
    Then the broker has the `expiry_awaited` queue
    Given a producer on another connection replying `expiry_awaited` queue
    Then the consumer receives the reply

  Scenario: A queue that was dropped is declared by the next Request
    Given a producer on another connection replying `expiry_idle` queue
    When the consumer sends a request to the `expiry_idle` queue
    Then the consumer receives the reply
    When that producer is gone
    Then the broker has no `expiry_idle` queue
    When the consumer sends a request to the `expiry_idle` queue
    Then the broker has the `expiry_idle` queue
    Given a producer on another connection replying `expiry_idle` queue
    Then the consumer receives the reply

  Scenario: A Request to a queue that is gone before its time is sent again

    The consumer has declared the queue a moment ago, and has no reason to declare it again
    yet. The broker returns the Request, which is what tells it.

    Given a producer on another connection replying `expiry_deleted` queue
    When the consumer sends a request to the `expiry_deleted` queue
    Then the consumer receives the reply
    When that producer is gone
    And the `expiry_deleted` queue is deleted
    And the consumer sends a request to the `expiry_deleted` queue
    And a producer on another connection replying `expiry_deleted` queue
    Then the consumer receives the reply

  Scenario: A queue declared without an expiry is used as it is

    It is what the queues of the versions before this one are, and the broker refuses to have
    one declared again as a queue that expires.

    Given the `expiry_legacy` queue declared without an expiry
    And a producer on another connection replying `expiry_legacy` queue
    When the consumer sends a request to the `expiry_legacy` queue
    Then the consumer receives the reply
    And the `legacy` event is emitted
    When that producer is gone
    And after 2500ms
    Then the broker has the `expiry_legacy` queue
