'use strict'

const { setWorldConstructor, setDefaultTimeout } = require('@cucumber/cucumber')
const { Context } = require('./context')

setWorldConstructor(Context)
setDefaultTimeout(10 * 1000)
