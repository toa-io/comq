declare namespace comq.diagnostics {

  type event = 'open' | 'close' | 'flow' | 'drain' | 'remove' | 'recover' | 'discard'

}

export type event = comq.diagnostics.event
