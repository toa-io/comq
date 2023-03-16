import * as _diagnostics from '../../../types/diagnostic'
import * as _io from '../../../types/io'

declare namespace comq.features {

  interface Context {
    io?: _io.IO
    connected?: boolean
    reply?: Promise<any>
    consumed?: Record<string, any>
    published?: any
    events?: { [K in _diagnostics.event]?: boolean }
    exception?: Error
    expected?: Promise<any>

    connect(user?: string, password?: string): Promise<void>
    disconnect(): Promise<void>
  }

}
