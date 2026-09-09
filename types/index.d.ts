import { Connect } from './connection'

export type { IO, Consumer, Producer } from './io'

export const connect: Connect
export const assert: Connect

/**
 * Thrown by a consumer to say that whatever it needed was briefly not there. This is
 * what an unclassified rejection already means, so throwing it changes nothing but the
 * reader's certainty.
 */
export class Retry extends Error {}

/**
 * Thrown by a consumer to say that it will never process this message, however many
 * times it is handed over. The message is kept rather than retried.
 *
 * Not applicable to a `Producer` given to `IO.reply`: a Request has a caller awaiting a
 * reply, so a verdict is a category error there and the message is retried and parked on
 * the count like any other failure.
 */
export class Park extends Error {}
