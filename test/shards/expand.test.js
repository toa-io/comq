'use strict'

const { expand } = require('../../source/shards/expand')

it('should leave a url without a range as it is', async () => {
  expect(expand('amqp://user:secret@rmq.example.com:5672/vhost?heartbeat=5'))
    .toStrictEqual(['amqp://user:secret@rmq.example.com:5672/vhost?heartbeat=5'])
})

it('should expand a range, its end being exclusive', async () => {
  expect(expand('amqp://rmq[0..3].example.com')).toStrictEqual([
    'amqp://rmq0.example.com',
    'amqp://rmq1.example.com',
    'amqp://rmq2.example.com'
  ])
})

it('should name as many hosts as the end of a range that starts at zero', async () => {
  expect(expand('amqp://rmq[0..32].example.com')).toHaveLength(32)
})

it('should keep what surrounds the host', async () => {
  expect(expand('amqps://user:secret@rmq-[1..3].example.com:5671/vhost?heartbeat=5')).toStrictEqual([
    'amqps://user:secret@rmq-1.example.com:5671/vhost?heartbeat=5',
    'amqps://user:secret@rmq-2.example.com:5671/vhost?heartbeat=5'
  ])
})

it('should pad to the width the start is written with', async () => {
  expect(expand('amqp://rmq[08..11]')).toStrictEqual(['amqp://rmq08', 'amqp://rmq09', 'amqp://rmq10'])
})

it('should expand every range', async () => {
  expect(expand('amqp://rmq[0..2].zone[0..2]')).toStrictEqual([
    'amqp://rmq0.zone0',
    'amqp://rmq0.zone1',
    'amqp://rmq1.zone0',
    'amqp://rmq1.zone1'
  ])
})

it('should leave an IPv6 literal alone', async () => {
  expect(expand('amqp://[::1]:5672')).toStrictEqual(['amqp://[::1]:5672'])
})

it('should look at the host only', async () => {
  const url = 'amqp://user:[0..2]@rmq.example.com/[0..2]?name=[0..2]'

  expect(expand(url)).toStrictEqual([url])
})

it('should leave what is not a url as it is', async () => {
  expect(expand('whatever')).toStrictEqual(['whatever'])
})

it.each(['[3..3]', '[3..1]'])('should refuse a range that names no hosts: %s', async (range) => {
  expect(() => expand(`amqp://rmq${range}`)).toThrow(RangeError)
})
