Feature: Tasks

  Background:
    Given an active connection to the broker

  Scenario: Sending and receiving a task
    Given tasks from the `hello` queue are being processed
    When a task is sent to the `hello` queue
    Then the task has been received
