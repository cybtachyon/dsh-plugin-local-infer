import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressThrottle } from '../src/store/progress-throttle.ts'
import { cardReducer } from '../src/store/reducer.ts'
import type { GetProgressState } from '../src/store/progress.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'

// makeStore builds a test store over the real reducer: dispatch reduces into
// the next snapshot, and getSnapshot reads it.
function makeStore() {
  let state: CardState = initialCardState()
  const store: CardStore = {
    dispatch(action) {
      state = cardReducer(state, action)
    },
    getSnapshot() {
      return state
    },
  }
  return { store, state: () => state }
}

// barState builds a GetProgressState the way the parser folds a byte bar.
function barState(percent: number): GetProgressState {
  return {
    step: 'Downloading x.safetensors',
    percent,
    doneBytes: (percent / 100) * 50.0e9,
    totalBytes: 50.0e9,
    etaSeconds: 2,
  }
}

describe('ProgressThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('patches immediately outside the window', () => {
    const { store, state } = makeStore()
    const throttle = new ProgressThrottle(store, 500)
    throttle.note(barState(10), false)
    expect(state().ui.getProgress).toEqual(barState(10))
    expect(throttle.latest).toEqual(barState(10))
  })

  it('arms one timer for a burst inside the window', () => {
    const { store, state } = makeStore()
    const throttle = new ProgressThrottle(store, 500)
    throttle.note(barState(10), false)
    throttle.note(barState(20), false)
    throttle.note(barState(30), false)
    // The burst held the first patch until the window's end.
    expect(state().ui.getProgress).toEqual(barState(10))
    vi.advanceTimersByTime(500)
    expect(state().ui.getProgress).toEqual(barState(30))
  })

  it('never overwrites a structured state with a text-parsed one', () => {
    const { store, state } = makeStore()
    const throttle = new ProgressThrottle(store, 500)
    throttle.note(barState(55), true)
    vi.advanceTimersByTime(500)
    throttle.note(barState(60), false)
    vi.advanceTimersByTime(500)
    expect(state().ui.getProgress).toEqual(barState(55))
  })

  it('settle lands the latest state, then clears the field', () => {
    const { store, state } = makeStore()
    const throttle = new ProgressThrottle(store, 500)
    throttle.note(barState(10), false)
    throttle.note(barState(20), false)
    throttle.settle()
    expect(state().ui.getProgress).toBeNull()
  })

  it('settle with no state clears the field', () => {
    const { store, state } = makeStore()
    const throttle = new ProgressThrottle(store, 500)
    throttle.settle()
    expect(state().ui.getProgress).toBeNull()
  })
})
