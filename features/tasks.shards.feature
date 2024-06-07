Feature: Tasks over sharded connection

  Background:
    Given an active sharded connection

  Scenario: Sending a task using sharded connection
    Given tasks from the `hello` queue are being processed
    When a task is sent to the `hello` queue
    Then the task has been received

  Scenario: Streaming tasks using sharded connection
    Given tasks from the `sharded` queue are being processed
    When a stream of 1k tasks is sent to the `sharded` queue
    Then 1k tasks have been processed
