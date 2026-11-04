/**
 * The getProgress throttle the performGet run drives: it patches the
 * ui.getProgress readout at a bounded cadence, so a burst of streamed tqdm
 * states (the get route's log and progress events) lands at most ~2 store
 * patches per second. A { progress } event (the server-parsed state) wins
 * over a text-parsed one, and settle lands the latest state before clearing
 * the readout, so it never outlives the run.
 * @module dsh-plugin-local-infer/client/store/progress-throttle
 */

import type { GetProgressState } from './progress.ts'
import type { CardStore } from './sync.ts'

/**
 * ProgressThrottle patches ui.getProgress at a minimum interval (the
 * performGet run's ~2 Hz cadence). A state that lands inside the interval
 * arms one timer for the interval's end, so a burst of updates patches at
 * most once per interval. A server-parsed state (a { progress } event) wins
 * over a text-parsed one: a text state that lands after the first
 * structured state is dropped. flush lands the latest state now, and
 * settle flushes, then clears the readout back to null.
 */
export class ProgressThrottle {
  private readonly store: CardStore
  private readonly intervalMs: number
  private latestState: GetProgressState | null = null
  private structured = false
  private lastPatch = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(store: CardStore, intervalMs: number) {
    this.store = store
    this.intervalMs = intervalMs
  }

  // The latest state the throttle holds: the performGet text parse folds a
  // new chunk against it.
  get latest(): GetProgressState | null {
    return this.latestState
  }

  // note records a progress state and patches it through the throttle: a
  // state that lands inside the interval arms a timer for the interval's
  // end. A text-parsed state never overwrites a server-parsed one.
  note(state: GetProgressState, structured: boolean): void {
    if (this.structured === true && structured === false) {
      return
    }
    this.latestState = state
    this.structured = structured
    const elapsed = Date.now() - this.lastPatch
    if (elapsed >= this.intervalMs) {
      this.flush()
      return
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.intervalMs - elapsed)
    }
  }

  // flush patches ui.getProgress with the latest state now, bypassing the
  // throttle: the run's final chunk and settle land the newest state.
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.latestState !== null) {
      this.lastPatch = Date.now()
      this.store.dispatch({
        type: 'ui/patch',
        patch: { getProgress: this.latestState },
      })
    }
  }

  // settle lands the latest state (the final chunk) and clears
  // ui.getProgress back to null: the readout must not outlive the run.
  settle(): void {
    this.flush()
    this.store.dispatch({ type: 'ui/patch', patch: { getProgress: null } })
  }
}
