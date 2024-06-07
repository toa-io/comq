Feature: Tasks

  Background:
    Given an active connection to the broker

  Scenario: Sending and receiving a task
    Given tasks from the `hello` queue are being processed
    When a task is sent to the `hello` queue
    Then the task has been received

  Scenario: Streaming tasks
    Given tasks from the `stream` queue are being processed
    When a stream of 1k tasks is sent to the `stream` queue
    Then 1k tasks have been processed
