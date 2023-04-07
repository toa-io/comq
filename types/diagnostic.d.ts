declare namespace comq.diagnostics {

  type event = 'open' | 'close' | 'flow' | 'drain' | 'remove' | 'recover' | 'discard'

  interface Diagnosable {
    diagnose(event: event, listener: Function): void
  }

}

export type event = comq.diagnostics.event
export type Diagnosable = comq.diagnostics.Diagnosable
