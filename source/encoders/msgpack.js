'use strict'

const { pack, unpack } = require('msgpackr')

exports.encode = pack
exports.decode = unpack
