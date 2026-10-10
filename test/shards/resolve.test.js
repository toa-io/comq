'use strict'

const { choose, hostOf, locate } = require('../../source/shards/resolve')

describe('choose', () => {
  it('should choose the same address whichever order they came in', async () => {
    expect(choose(['10.0.0.2', '10.0.0.1'])).toStrictEqual('10.0.0.1')
    expect(choose(['10.0.0.1', '10.0.0.2'])).toStrictEqual('10.0.0.1')
  })

  it('should prefer IPv4', async () => {
    expect(choose(['::1', '127.0.0.1'])).toStrictEqual('127.0.0.1')
  })

  it('should keep the address in use while it is listed', async () => {
    expect(choose(['10.0.0.1', '10.0.0.2'], '10.0.0.2')).toStrictEqual('10.0.0.2')
  })

  it('should let go of an address that is no longer listed', async () => {
    expect(choose(['10.0.0.1', '10.0.0.3'], '10.0.0.2')).toStrictEqual('10.0.0.1')
  })
})

describe('hostOf', () => {
  it('should tell the name', async () => {
    expect(hostOf('amqp://user:secret@rmq.example.com:5672/vhost')).toStrictEqual('rmq.example.com')
  })

  it.each(['amqp://10.0.0.1:5672', 'amqp://[::1]', 'whatever'])('should tell nothing of %s',
    async (url) => {
      expect(hostOf(url)).toBeUndefined()
    })
})

describe('locate', () => {
  it('should put the address in place of the name, which the broker is verified by', async () => {
    expect(locate('amqps://user:secret@rmq.example.com:5671/vhost?heartbeat=5', '10.0.0.1')).toStrictEqual({
      url: 'amqps://user:secret@10.0.0.1:5671/vhost?heartbeat=5',
      address: '10.0.0.1',
      servername: 'rmq.example.com'
    })
  })

  it('should bracket an IPv6 address', async () => {
    expect(locate('amqp://rmq.example.com:5672', '::1').url).toStrictEqual('amqp://[::1]:5672')
  })

  it('should locate the names of one broker alike', async () => {
    const one = locate('amqp://rmq0.example.com', '10.0.0.1')
    const another = locate('amqp://rmq1.example.com', '10.0.0.1')

    expect(one.url).toStrictEqual(another.url)
  })

  it('should tell brokers apart by port, credentials and virtual host', async () => {
    const urls = [
      'amqp://rmq.example.com',
      'amqp://rmq.example.com:5673',
      'amqp://user:secret@rmq.example.com',
      'amqp://rmq.example.com/vhost'
    ].map((url) => locate(url, '10.0.0.1').url)

    expect(new Set(urls).size).toStrictEqual(urls.length)
  })

  it('should leave an address as it is', async () => {
    expect(locate('amqp://10.0.0.1:5672')).toStrictEqual({ url: 'amqp://10.0.0.1:5672', address: '10.0.0.1' })
  })

  it('should leave what is not a url as it is', async () => {
    expect(locate('whatever')).toStrictEqual({ url: 'whatever', address: 'whatever' })
  })
})
