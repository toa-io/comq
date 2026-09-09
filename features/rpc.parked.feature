Feature: Parked requests

  Background:
    Given an active connection to the broker

  Scenario: A parked request can still be answered

    A caller is certain of an eventual answer for as long as it is alive, and parking
    is what keeps that true when no consumer can produce one: the request is not
    deleted, and it keeps who was asking. Somebody else can answer it, and the caller
    — still waiting, still holding an exclusive reply queue — receives it.

    This is why there is no request timeout and no way to withdraw a request: either
    would leave the parked message addressed to a caller that is no longer listening.

    Given a producer failing every request to the `unanswerable` queue
    When a request is sent to the `unanswerable` queue
    Then the request is parked
    When the parked request from the `unanswerable` queue is answered by hand
    Then the caller receives the reply
