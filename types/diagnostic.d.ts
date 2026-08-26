declare namespace comq.diagnostics {

  type Event = 'open' | 'close' | 'error' | 'reconnect' | 'flow' | 'drain' | 'remove' | 'lost' |
    'recover' | 'discard' | 'pause' | 'resume' | 'return'

  interface Diagnosable {
    diagnose(event: Event, listener: Function): void
  }

}

export type Event = comq.diagnostics.Event
export type Diagnosable = comq.diagnostics.Diagnosable
