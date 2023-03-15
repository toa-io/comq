'use strict'

const json = require('./json')
const msgpack = require('./msgpack')
const plain = require('./plain')

exports['application/json'] = json
exports['application/msgpack'] = msgpack
exports['text/plain'] = plain
