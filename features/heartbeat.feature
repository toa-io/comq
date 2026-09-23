@heavy
Feature: Idle connection tolerance

  A connection that says nothing but heartbeats is as healthy as a busy one, and is kept for as
  long as the broker goes on answering them, however long that is.

  Background:
    Given 1s AMQP heartbeat

  Scenario: Keeping an idle connection
    Given an active connection to the broker
    Then the connection is not lost for 20 seconds

  Scenario: Keeping an idle sharded connection
    Given an active sharded connection
    Then the connection is not lost for 20 seconds
