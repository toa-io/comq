Feature: Request-Reply Topology Recovery

  Background:
    Given an active connection to the broker

  Scenario: Defining a producer while the broker is down
    Given the broker is down
    And function replying `add_numbers` queue is expected:
    """
    ({ a, b }) => { return a + b }
    """
    When the broker is up
    And the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 1
    b: 2
    """
    Then the consumer receives the reply:
    """yaml
    3
    """

  Scenario: Broker crashing while defining a producer
    Given function replying `add_numbers` queue is expected:
    """
    ({ a, b }) => { return a + b }
    """
    And the broker has crashed
    When the broker is up
    And the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 1
    b: 2
    """
    Then the consumer receives the reply:
    """yaml
    3
    """

  Scenario: Sending the request while broker is down
    Given function replying `add_numbers` queue:
    """
    ({ a, b }) => { return a + b }
    """
    And the broker has crashed
    When the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 1
    b: 2
    """
    Then the broker is up
    And the consumer receives the reply:
    """yaml
    3
    """

  Scenario: Broker crashing while sending a request

  First Request-Reply pair will assert queues, so crash will happen while calling AMQP.publish()

    Given function replying `add_numbers` queue:
    """
    ({ a, b }) => new Promise((resolve, reject) => setTimeout(() => resolve(a + b), 100))
    """
    When the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 1
    b: 2
    """
    And the consumer receives the reply:
    """yaml
    3
    """
    When the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 2
    b: 3
    """
    And the broker has crashed
    Then the broker is up
    And the consumer receives the reply:
    """yaml
    5
    """

  Scenario: Defining emitter while the broker is down
    Given the broker is down
    And `logger` consuming events from the `numbers_added` exchange is expected
    When the broker is up
    And an event is emitted to the `numbers_added` exchange
    Then `logger` receives the event

  Scenario: Defining emitter while broker crashed
    Given `someone` consuming events from the `numbers_added` exchange is expected
    And the broker has crashed
    When the broker is up
    Then an event is emitted to the `numbers_added` exchange
    And `someone` receives the event

  Scenario: Start consuming events while broker is down
    Given that `first` is consuming events from the `numbers_added` exchange
    And `second` consuming events from the `numbers_added` exchange is expected
    When the broker has crashed
    And the broker is up
    Then an event is emitted to the `numbers_added` exchange
    And `second` receives the event
