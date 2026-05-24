/**
 * @file ComQ type definitions (JSDoc source of truth).
 *
 * Public API types live in the {@link comq} namespace. Import this module only
 * when you need {@link import('./types')} references from other files; it has no
 * runtime exports.
 */

/**
 * @typedef {'application/msgpack' | 'application/json' | 'application/octet-stream' | 'text/plain'} comq.Encoding
 */

/**
 * @typedef {'request' | 'reply' | 'event'} comq.topology.type
 */

/**
 * @typedef {Object} comq.Topology
 * @property {number} prefetch
 * @property {boolean} confirms
 * @property {boolean} durable
 * @property {boolean} acknowledgments
 * @property {boolean} persistent
 */

/**
 * @typedef {Object} comq.topology.Set
 * @property {comq.Topology} request
 * @property {comq.Topology} reply
 * @property {comq.Topology} event
 */

/**
 * @callback comq.Producer
 * @param {any} message
 * @returns {any | Promise<any>}
 */

/**
 * @callback comq.Consumer
 * @param {any} message
 * @param {comq.amqp.Properties} [headers]
 * @returns {void | Promise<void>}
 */

/**
 * @typedef {import('node:events').EventEmitter & { queue: string }} comq.ReplyEmitter
 */

/**
 * @typedef {import('node:events').EventEmitter & { destroy(): void }} comq.Destroyable
 */

/**
 * @typedef {Object} comq.Request
 * @property {Buffer} buffer
 * @property {comq.ReplyEmitter} emitter
 * @property {comq.amqp.Properties} properties
 */

/**
 * @typedef {'open' | 'close' | 'flow' | 'drain' | 'remove' | 'recover' | 'discard' | 'pause' | 'resume' | 'return'} comq.diagnostics.Event
 */

/**
 * AMQP connection handle returned by `amqplib.connect()`.
 * @typedef {import('amqplib').ChannelModel} comq.amqp.Connection
 */

/**
 * @typedef {import('amqplib').Channel | import('amqplib').ConfirmChannel} comq.amqp.Channel
 */

/**
 * @typedef {import('amqplib').Message} comq.amqp.Message
 */

/**
 * @typedef {Partial<import('amqplib').MessageProperties>} comq.amqp.Properties
 */

/**
 * @typedef {import('amqplib').Options.Consume} comq.amqp.options.Consume
 */

/**
 * @typedef {import('amqplib').Options.Publish} comq.amqp.options.Publish
 */

/**
 * @typedef {import('amqplib').Options.AssertExchange} comq.amqp.options.Exchange
 */

/**
 * @typedef {import('amqplib').Options.AssertQueue} comq.amqp.options.Queue
 */

/**
 * @callback comq.channels.Consumer
 * @param {comq.amqp.Message} message
 * @returns {void | Promise<void>}
 */

/**
 * @typedef {Object} comq.Channel
 * @property {number} [index]
 * @property {boolean} [sharded]
 * @property {() => Promise<void>} create
 * @property {(queue: string, consumer: comq.channels.Consumer) => Promise<string>} consume
 * @property {(exchange: string, queue: string, consumer: comq.channels.Consumer) => Promise<void>} subscribe
 * @property {(queue: string, buffer: Buffer, options?: comq.amqp.options.Publish) => Promise<void>} send
 * @property {(exchange: string, buffer: Buffer, options?: comq.amqp.options.Publish) => Promise<void>} publish
 * @property {(queue: string, buffer: Buffer, options?: comq.amqp.options.Publish) => Promise<boolean>} fire
 * @property {() => Promise<void>} seal
 * @property {(event: comq.diagnostics.Event, listener: Function) => void} diagnose
 * @property {(event: comq.diagnostics.Event, listener: Function) => void} forget
 * @property {(connection: import('amqplib').ChannelModel) => Promise<void>} [recover]
 */

/**
 * @typedef {Object} comq.Connection
 * @property {() => Promise<void>} open
 * @property {() => Promise<void>} close
 * @property {(type: comq.topology.type, index?: number) => Promise<comq.Channel>} createChannel
 * @property {(event: comq.diagnostics.Event, listener: Function) => void} diagnose
 */

/**
 * @callback comq.Connect
 * @param {...string} urls
 * @returns {Promise<comq.IO>}
 */

/**
 * @typedef {Object} comq.IO
 * @property {(queue: string, produce: comq.Producer) => Promise<void>} reply
 * @property {(queue: string, payload: any, encoding?: comq.Encoding) => Promise<any>} request
 * @property {(queue: string, stream: import('node:stream').Readable, encoding?: comq.Encoding) => Promise<import('node:stream').Readable>} request
 * @property {(exchange: string, group: string, consumer: comq.Consumer) => Promise<void>} consume
 * @property {(exchange: string, consumer: comq.Consumer) => Promise<void>} consume
 * @property {(exchange: string, payload: any, encoding?: comq.Encoding) => Promise<void>} emit
 * @property {(exchange: string, payload: any, properties?: comq.amqp.Properties) => Promise<void>} emit
 * @property {(exchange: string, stream: import('node:stream').Readable, encoding?: comq.Encoding) => Promise<void>} emit
 * @property {(exchange: string, stream: import('node:stream').Readable, properties?: comq.amqp.Properties) => Promise<void>} emit
 * @property {(exchange: string, payload: any, encoding?: comq.Encoding) => Promise<void>} enqueue
 * @property {(exchange: string, payload: any, properties?: comq.amqp.Properties) => Promise<void>} enqueue
 * @property {(exchange: string, stream: import('node:stream').Readable, encoding?: comq.Encoding) => Promise<void>} enqueue
 * @property {(exchange: string, stream: import('node:stream').Readable, properties?: comq.amqp.Properties) => Promise<void>} enqueue
 * @property {(queue: string, processor: comq.Consumer) => Promise<void>} process
 * @property {() => Promise<void>} seal
 * @property {() => Promise<void>} close
 * @property {(event: 'open', listener: (index?: number) => void) => void} diagnose
 * @property {(event: 'close', listener: (index?: number) => void) => void} diagnose
 * @property {(event: 'flow', listener: (channel: comq.topology.type, index?: number) => void) => void} diagnose
 * @property {(event: 'drain', listener: (channel: comq.topology.type, index?: number) => void) => void} diagnose
 * @property {(event: 'remove', listener: (index?: number) => void) => void} diagnose
 * @property {(event: 'recover', listener: (channel: comq.topology.type, index?: number) => void) => void} diagnose
 * @property {(event: 'discard', listener: (channel: comq.topology.type, message: any, index?: number) => void) => void} diagnose
 * @property {(event: 'pause', listener: (channel: comq.topology.type) => void) => void} diagnose
 * @property {(event: 'resume', listener: (channel: comq.topology.type) => void) => void} diagnose
 */

/**
 * @typedef {Object} comq.features.Context
 * @property {comq.IO} [io]
 * @property {boolean} [connected]
 * @property {Promise<any>} connecting
 * @property {Promise<any>[]} requestsSent
 * @property {Promise<any>} [reply]
 * @property {Buffer} [published]
 * @property {number} eventsPublishedCount
 * @property {number} eventsConsumedCount
 * @property {Record<string, { payload: any, properties?: comq.amqp.Properties }>} consumed
 * @property {number} consumedCount
 * @property {Partial<Record<comq.diagnostics.Event, boolean>>} [events]
 * @property {any} [enqueued]
 * @property {any} processed
 * @property {number} tasksProcessedCount
 * @property {Error} [exception]
 * @property {Promise<any>} [consumptionPromise]
 * @property {boolean} sharded
 * @property {number} shard
 * @property {Promise<any>} sealing
 * @property {any} sending
 * @property {any} publishing
 * @property {import('node:stream').Readable} stream
 * @property {any[]} streamValues
 * @property {boolean} streamEnded
 * @property {Record<number, import('node:stream').Readable>} streams
 * @property {Record<number, any[]>} streamsValues
 * @property {Record<number, boolean>} streamsEnded
 * @property {boolean} generatorDestroyed
 * @property {(user?: string, password?: string) => Promise<void>} connect
 * @property {(user?: string, password?: string) => Promise<void>} assert
 * @property {() => Promise<void>} disconnect
 */
