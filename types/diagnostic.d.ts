declare namespace comq.diagnostics {

  type Event = 'open' | 'close' | 'flow' | 'drain' | 'remove' | 'recover' | 'discard' |
    'pause' | 'resume' | 'return'

  interface Diagnosable {
    diagnose(event: Event, listener: Function): void
  }

}

export type Event = comq.diagnostics.Event
export type Diagnosable = comq.diagnostics.Diagnosable
