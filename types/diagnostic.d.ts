declare namespace comq.diagnostics {

  type event = 'open' | 'close' | 'flow' | 'drain' | 'recover' | 'discard'

}

export type event = comq.diagnostics.event
