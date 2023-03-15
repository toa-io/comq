declare namespace comq {

  type encoding =
    'application/msgpack'
    | 'application/json'
    | 'application/octet-stream'
    | 'text/plain'

}

export type encoding = comq.encoding
