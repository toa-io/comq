declare namespace comq {

  type Encoding =
    'application/msgpack'
    | 'application/json'
    | 'application/octet-stream'
    | 'text/plain'

}

export type Encoding = comq.Encoding
