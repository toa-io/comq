'use strict'

/**
 * Runs an operation until it stops asking for another attempt, waiting longer before
 * each one. The operation is handed the token it returns to ask for a retry; anything
 * else it returns is the result, and whatever it throws is thrown on.
 *
 * @template T
 * @param {(again: symbol) => Promise<T | symbol>} operation
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {Promise<T>}
 */
async function retry (operation, options) {
  const { attempts, base, max, factor, dispersion } = { ...DEFAULTS, ...options }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await operation(again)

    if (result !== again) return /** @type {T} */ (result)

    const interval = Math.min(base * factor ** attempt, max)

    // attempts that started together are spread out rather than kept in step
    const spread = interval * dispersion * (Math.random() - 0.5)

    await new Promise((resolve) => setTimeout(resolve, interval + spread))
  }

  throw new Error('Maximum attempts exceeded')
}

const again = Symbol('again')

const DEFAULTS = {
  attempts: Infinity,
  base: 1000,
  max: 30000,
  factor: 1.5,
  dispersion: 0.1
}

exports.retry = retry
