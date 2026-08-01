Feature: Back pressure handling

  Background:
    Given an active connection to the broker

  Scenario: Flooding a queue
    Given function replying `flood` queue:
    """
    () => { return Buffer.from('ok') }
    """
    When I'm flooding the `flood` queue until back pressure is applied
