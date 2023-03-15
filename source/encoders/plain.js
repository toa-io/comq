'use strict'

exports.encode = (value) => Buffer.from(value.toString())
exports.decode = (buffer) => buffer.toString()
