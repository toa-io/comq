import * as _diagnostics from '../../../types/diagnostic'
import * as _io from '../../../types/io'

declare namespace comq.features {

  interface Context {
    url?: string
    io?: _io.IO
    reply?: Promise<any>
    consumed?: Record<string, any>
    published?: any
    events?: { [K in _diagnostics.event]?: boolean }
    exception?: Error
    expected: Promise<any>

    connect(user?: string, password?: string): Promise<void>
  }

}
