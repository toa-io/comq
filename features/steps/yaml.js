'use strict'

const { load } = require('js-yaml')

/**
 * @param {string} [yaml]
 * @returns {any}
 */
function parse (yaml) {
  if (yaml === undefined || yaml.trim() === '') return undefined

  return load(yaml)
}

exports.parse = parse
