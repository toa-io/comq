declare namespace comq.diagnostics {

  type Event = 'open' | 'close' | 'error' | 'reconnect' | 'exhausted' | 'flow' | 'drain' |
    'remove' | 'lost' | 'recover' | 'discard' | 'retry' | 'pause' | 'resume' | 'return' | 'locked'

  interface Diagnosable {
    diagnose(event: Event, listener: Function): void
  }

}

export type Event = comq.diagnostics.Event
export type Diagnosable = comq.diagnostics.Diagnosable
