'use strict'

/**
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
const concat = (left, right) => left + SEPARATOR + right

const SEPARATOR = '..'

exports.concat = concat
