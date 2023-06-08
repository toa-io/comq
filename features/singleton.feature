Feature: Singleton connection

  Scenario: Establishing singleton connection
    Given an active singleton connection

  Scenario: Establishing sharded singleton connection
    Given an active sharded singleton connection

  Scenario: Sending request and getting reply
    Given an active singleton connection
    And function replying `add_numbers` queue:
    """
    ({ a, b }) => { return a + b }
    """
    When the consumer sends the following request to the `add_numbers` queue:
    """yaml
    a: 1
    b: 2
    """
    Then the consumer receives the reply:
    """yaml
    3
    """
