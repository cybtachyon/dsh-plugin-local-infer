import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_TIMEOUT_DETAIL, cardReducer } from '../src/store/reducer.ts'
import { ACTION_TIMEOUTS, performAction, type CardStore } from '../src/store/sync.ts'
import {
  initialCardState,
  type CardAction,
  type CardState,
} from '../src/store/types.ts'

// makeStore builds a test store over the real reducer: dispatch reduces
// into the next snapshot, and dispatched records every action for the
// double-start and late-ack assertions.
function makeStore() {
  let state: CardState = initialCardState()
  const dispatched: CardAction[] = []
  const store: CardStore = {
    dispatch(action: CardAction) {
      dispatched.push(action)
      state = cardReducer(state, action)
    },
    getSnapshot() {
      return state
    },
  }
  return { store, dispatched }
}

// deferred builds a controllable promise: the test holds the resolve and
// reject and settles the round trip on its own schedule.
function deferred() {
  let resolve: (value: string) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('client store sync (store/sync.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pins the per-action timeout table', () => {
    expect(ACTION_TIMEOUTS).toEqual({
      save: 30_000,
      install: 120_000,
      register: 30_000,
      unregister: 30_000,
      launch: 150_000,
      stop: 10_000,
      get: 120_000,
      download: 120_000,
    })
  })

  it('an ack clears pending and the deadline timer', async () => {
    const { store, dispatched } = makeStore()
    const round = deferred()
    const done = performAction(store, 'save', () => round.promise, ACTION_TIMEOUTS.save)
    // The start moved the cell to pending before the round trip ran.
    expect(store.getSnapshot().actions.save.status).toBe('pending')
    round.resolve('saved')
    await done
    expect(store.getSnapshot().actions.save).toEqual({ status: 'ok', detail: 'saved' })
    // The timer cleared on settle: advancing past the deadline no-ops.
    vi.advanceTimersByTime(ACTION_TIMEOUTS.save)
    expect(store.getSnapshot().actions.save).toEqual({ status: 'ok', detail: 'saved' })
    expect(dispatched.filter((action) => action.type === 'action/timeout')).toEqual([])
  })

  it('a rejection fails the action with the error message', async () => {
    const { store } = makeStore()
    const round = deferred()
    const done = performAction(
      store,
      'install',
      () => round.promise,
      ACTION_TIMEOUTS.install,
    )
    round.reject(new Error('build failed'))
    await done
    expect(store.getSnapshot().actions.install).toEqual({
      status: 'error',
      detail: 'build failed',
    })
  })

  it('a non-Error rejection stringifies the detail', async () => {
    const { store } = makeStore()
    const round = deferred()
    const done = performAction(store, 'stop', () => round.promise, ACTION_TIMEOUTS.stop)
    round.reject('stopped short')
    await done
    expect(store.getSnapshot().actions.stop).toEqual({
      status: 'error',
      detail: 'stopped short',
    })
  })

  it('a timeout marks the action error and a late ack leaves it unchanged', async () => {
    const { store, dispatched } = makeStore()
    const round = deferred()
    const done = performAction(
      store,
      'launch',
      () => round.promise,
      ACTION_TIMEOUTS.launch,
    )
    vi.advanceTimersByTime(ACTION_TIMEOUTS.launch)
    expect(store.getSnapshot().actions.launch).toEqual({
      status: 'error',
      detail: ACTION_TIMEOUT_DETAIL,
    })
    // The late ack must not clobber the timeout detail.
    round.resolve('late')
    await done
    expect(store.getSnapshot().actions.launch).toEqual({
      status: 'error',
      detail: ACTION_TIMEOUT_DETAIL,
    })
    expect(dispatched.filter((action) => action.type === 'action/ack')).toEqual([])
  })

  it('two concurrent calls for the same key do not double-start', async () => {
    const { store, dispatched } = makeStore()
    const first = deferred()
    const second = deferred()
    const doneFirst = performAction(
      store,
      'download',
      () => first.promise,
      ACTION_TIMEOUTS.download,
    )
    const doneSecond = performAction(
      store,
      'download',
      () => second.promise,
      ACTION_TIMEOUTS.download,
    )
    // The second call saw the pending cell and skipped: one start, and
    // the second round trip never runs.
    expect(dispatched.filter((action) => action.type === 'action/start')).toHaveLength(1)
    first.resolve('downloaded')
    await doneFirst
    expect(store.getSnapshot().actions.download).toEqual({
      status: 'ok',
      detail: 'downloaded',
    })
    // The skipped call resolved without touching the cell.
    await doneSecond
    expect(store.getSnapshot().actions.download).toEqual({
      status: 'ok',
      detail: 'downloaded',
    })
  })
})
