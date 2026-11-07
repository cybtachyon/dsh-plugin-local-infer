import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import {
  clearRunInFlight,
  clearStreamFollowed,
  markRunInFlight,
  markStreamFollowed,
} from '../src/store/run-markers.ts'
import { cardReducer, ACTION_TIMEOUT_DETAIL } from '../src/store/reducer.ts'
import { initialCardState, type CardDraft, type CardState } from '../src/store/types.ts'
import type { GetProgressState } from '../src/store/progress.ts'

// A minimal summary carrying every field the reducer reads (engineId, config,
// platformConfigs, showHelp, logPath). The complex view-model fields are empty
// objects; the cast keeps the fixture short without importing each model type.
const BASE_SUMMARY = {
  engines: [],
  models: [],
  hardware: {},
  engineId: 'ninfer',
  formModel: {},
  meterModel: {},
  verdict: {},
  warningsModel: {},
  config: {},
  platformConfigs: {},
  defaults: {},
  modelDirectory: '/models',
  modelDefaults: [],
  modelStatus: null,
  chatTemplateStatus: null,
  modelFiles: [],
  showHelp: true,
  providers: [],
  logPath: '',
  lastLogs: '',
  unsureBanner: null,
  registered: false,
}

function makeSummary(overrides: Partial<LocalInferSummary> = {}): LocalInferSummary {
  return { ...BASE_SUMMARY, ...overrides } as LocalInferSummary
}

function makeDraft(overrides: Partial<CardDraft> = {}): CardDraft {
  return { engine: 'ninfer', config: {}, ...overrides }
}

// A state with a summary and a draft already in place, the shape the card has
// after its first summary ack.
function madeState(overrides: Partial<CardState> = {}): CardState {
  const summary = makeSummary()
  return {
    ...initialCardState(),
    summary,
    draft: makeDraft(),
    ...overrides,
  }
}

describe('client store reducer (store/reducer.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('draft/edit', () => {
    it('stores the draft, sets dirty, and clears the save and deps notes', () => {
      const state = madeState({
        dirty: false,
        notes: { deps: 'stale deps', copy: 'kept' },
        actions: {
          ...initialCardState().actions,
          save: { status: 'ok', detail: 'saved' },
        },
      })
      const next = cardReducer(state, {
        type: 'draft/edit',
        draft: makeDraft({ config: { context: 4096 } }),
      })
      expect(next.draft).toEqual(makeDraft({ config: { context: 4096 } }))
      expect(next.dirty).toBe(true)
      expect(next.actions.save.detail).toBe('')
      expect(next.actions.save.status).toBe('ok')
      expect(next.notes.deps).toBe('')
      expect(next.notes.copy).toBe('kept')
    })

    it('preserves a save still in flight (the status is not clobbered)', () => {
      const state = madeState({
        actions: {
          ...initialCardState().actions,
          save: { status: 'pending', detail: '' },
        },
      })
      const next = cardReducer(state, { type: 'draft/edit', draft: makeDraft() })
      expect(next.actions.save.status).toBe('pending')
      expect(next.actions.save.detail).toBe('')
    })
  })

  describe('summary/ack', () => {
    it('stores the summary, clears the summary note and the live Logs buffer', () => {
      const state = madeState({
        summaryNote: 'load failed',
        ui: {
          ...initialCardState().ui,
          logs: { liveLogs: 'streamed tail', height: 96, scrollMode: 'scrolling' },
        },
      })
      const summary = makeSummary({ engineId: 'llama', logPath: '/var/log/x' })
      const next = cardReducer(state, { type: 'summary/ack', summary })
      expect(next.summary).toBe(summary)
      expect(next.summaryNote).toBe('')
      expect(next.ui.logs.liveLogs).toBeNull()
      // The rest of the logs pane is preserved.
      expect(next.ui.logs.height).toBe(96)
      expect(next.ui.logs.scrollMode).toBe('scrolling')
    })

    it('keeps the live Logs buffer while a run is in flight', () => {
      markRunInFlight('p1')
      try {
        const state = madeState({
          ui: {
            ...initialCardState().ui,
            logs: { liveLogs: 'streamed tail', height: 96, scrollMode: 'scrolling' },
          },
        })
        const next = cardReducer(state, { type: 'summary/ack', summary: makeSummary() })
        // The stop fast-poll or a debounced re-price mid-run must not wipe
        // the buffer the attached run-log stream feeds.
        expect(next.ui.logs.liveLogs).toBe('streamed tail')
      } finally {
        clearRunInFlight('p1')
      }
    })

    it('keeps the live Logs buffer while the pane follows a run-log stream', () => {
      markStreamFollowed('p1')
      try {
        const state = madeState({
          ui: {
            ...initialCardState().ui,
            logs: { liveLogs: 'streamed tail', height: 96, scrollMode: 'scrolling' },
          },
        })
        const next = cardReducer(state, { type: 'summary/ack', summary: makeSummary() })
        expect(next.ui.logs.liveLogs).toBe('streamed tail')
      } finally {
        clearStreamFollowed('p1')
      }
    })

    it('merges the platform field-level: local edits survive the re-price', () => {
      const state = madeState({
        draft: makeDraft({
          platform: {
            ninfer: { engineDirectory: '/local/edit', dockerTag: 'local-tag' },
            llama: { engineFork: 'https://fork' },
          },
        }),
      })
      const summary = makeSummary({
        platformConfigs: {
          ninfer: { engineDirectory: '/persisted', buildCommands: 'cmake' },
        },
      })
      const next = cardReducer(state, { type: 'summary/ack', summary })
      // The persisted fields surface, and the local edits layer on top.
      expect(next.draft?.platform?.ninfer).toEqual({
        engineDirectory: '/local/edit',
        dockerTag: 'local-tag',
        buildCommands: 'cmake',
      })
      // An engine with only a local edit keeps it (no persisted entry to merge).
      expect(next.draft?.platform?.llama).toEqual({ engineFork: 'https://fork' })
      expect(next.draft?.engine).toBe('ninfer')
      expect(next.draft?.config).toEqual({})
    })

    it('seeds the draft from the summary when no draft is present', () => {
      const state = { ...initialCardState(), draft: null }
      const summary = makeSummary({ engineId: 'strata', config: { model: 'm' } })
      const next = cardReducer(state, { type: 'summary/ack', summary })
      expect(next.draft).toEqual({
        engine: 'strata',
        config: { model: 'm' },
        platform: {},
      })
    })

    it('seeds help and logPath from the stored preference', () => {
      const state = madeState({
        ui: { ...initialCardState().ui, help: false, logPath: '/old' },
      })
      const next = cardReducer(state, {
        type: 'summary/ack',
        summary: makeSummary({ showHelp: false, logPath: '/new' }),
      })
      expect(next.ui.help).toBe(false)
      expect(next.ui.logPath).toBe('/new')
      // A blank logPath keeps the previous value.
      const blank = cardReducer(state, {
        type: 'summary/ack',
        summary: makeSummary({ logPath: '' }),
      })
      expect(blank.ui.logPath).toBe('/old')
      // A summary that predates the showHelp key keeps the descriptions visible.
      const predates = cardReducer(
        { ...state, ui: { ...initialCardState().ui, help: false } },
        { type: 'summary/ack', summary: makeSummary({ showHelp: true }) },
      )
      expect(predates.ui.help).toBe(true)
    })
  })

  describe('summary/fail', () => {
    it('sets the summary note', () => {
      const next = cardReducer(madeState(), {
        type: 'summary/fail',
        note: 'load failed: boom',
      })
      expect(next.summaryNote).toBe('load failed: boom')
    })
  })

  describe('deps/ack and deps/fail', () => {
    it('stores the deps model and clears the deps note on ack', () => {
      const deps = { runAllowed: true, items: [] }
      const state = madeState({ notes: { deps: 'stale', copy: '' } })
      const next = cardReducer(state, { type: 'deps/ack', deps })
      expect(next.deps).toBe(deps)
      expect(next.notes.deps).toBe('')
    })

    it('sets the deps note on fail', () => {
      const next = cardReducer(madeState(), {
        type: 'deps/fail',
        note: 'deps failed',
      })
      expect(next.notes.deps).toBe('deps failed')
      expect(next.deps).toBeNull()
    })

    it('clears the deps model and the deps note on clear', () => {
      const deps = { runAllowed: true, items: [] }
      const state = madeState({ deps, notes: { deps: 'stale', copy: 'kept' } })
      const next = cardReducer(state, { type: 'deps/clear' })
      expect(next.deps).toBeNull()
      expect(next.notes.deps).toBe('')
      expect(next.notes.copy).toBe('kept')
    })
  })

  describe('draft/discard', () => {
    it('resets the draft from the summary and clears dirty', () => {
      const state = madeState({
        dirty: true,
        draft: makeDraft({ config: { context: 9999 }, platform: { ninfer: { dockerTag: 'x' } } }),
      })
      const next = cardReducer(state, { type: 'draft/discard' })
      expect(next.dirty).toBe(false)
      expect(next.draft).toEqual({
        engine: 'ninfer',
        config: {},
        platform: {},
      })
    })

    it('clears the draft to null when there is no summary', () => {
      const state = { ...initialCardState(), draft: makeDraft(), dirty: true }
      const next = cardReducer(state, { type: 'draft/discard' })
      expect(next.draft).toBeNull()
      expect(next.dirty).toBe(false)
    })
  })

  describe('action lifecycle (pending -> ack | timeout)', () => {
    it('action/start moves the cell to pending with an empty detail', () => {
      const state = madeState({
        actions: {
          ...initialCardState().actions,
          save: { status: 'ok', detail: 'saved' },
        },
      })
      const next = cardReducer(state, { type: 'action/start', key: 'save' })
      expect(next.actions.save).toEqual({ status: 'pending', detail: '' })
    })

    it('action/ack settles a pending cell to ok', () => {
      const pending = cardReducer(madeState(), { type: 'action/start', key: 'save' })
      const next = cardReducer(pending, { type: 'action/ack', key: 'save', detail: 'saved' })
      expect(next.actions.save).toEqual({ status: 'ok', detail: 'saved' })
    })

    it('a late action/ack after a timeout is a no-op', () => {
      const pending = cardReducer(madeState(), { type: 'action/start', key: 'launch' })
      const timedOut = cardReducer(pending, { type: 'action/timeout', key: 'launch' })
      expect(timedOut.actions.launch).toEqual({
        status: 'error',
        detail: ACTION_TIMEOUT_DETAIL,
      })
      // The late ack must not clobber the timeout detail.
      const late = cardReducer(timedOut, {
        type: 'action/ack',
        key: 'launch',
        detail: 'saved',
      })
      expect(late).toBe(timedOut)
    })

    it('action/fail settles a pending cell to error', () => {
      const pending = cardReducer(madeState(), { type: 'action/start', key: 'stop' })
      const next = cardReducer(pending, { type: 'action/fail', key: 'stop', detail: 'stop failed' })
      expect(next.actions.stop).toEqual({ status: 'error', detail: 'stop failed' })
    })

    it('a late action/fail after an ack is a no-op', () => {
      const pending = cardReducer(madeState(), { type: 'action/start', key: 'get' })
      const acked = cardReducer(pending, { type: 'action/ack', key: 'get', detail: 'ok' })
      const late = cardReducer(acked, { type: 'action/fail', key: 'get', detail: 'late' })
      expect(late).toBe(acked)
    })

    it('action/timeout moves a pending cell to error with the timeout detail', () => {
      const pending = cardReducer(madeState(), { type: 'action/start', key: 'download' })
      const next = cardReducer(pending, { type: 'action/timeout', key: 'download' })
      expect(next.actions.download).toEqual({ status: 'error', detail: 'timeout' })
    })

    it('a timeout on an idle cell is a no-op', () => {
      const state = madeState()
      const next = cardReducer(state, { type: 'action/timeout', key: 'install' })
      expect(next).toBe(state)
    })

    it('settling one key leaves the other action cells untouched', () => {
      let state = madeState()
      state = cardReducer(state, { type: 'action/start', key: 'save' })
      state = cardReducer(state, { type: 'action/start', key: 'stop' })
      const next = cardReducer(state, { type: 'action/ack', key: 'save', detail: 'saved' })
      expect(next.actions.save).toEqual({ status: 'ok', detail: 'saved' })
      expect(next.actions.stop).toEqual({ status: 'pending', detail: '' })
    })
  })

  describe('template lifecycle', () => {
    it('template/start moves the cell to pending', () => {
      const next = cardReducer(madeState(), { type: 'template/start' })
      expect(next.templateActions.download).toEqual({ status: 'pending', detail: '' })
    })

    it('template/ack settles a pending cell to ok', () => {
      const pending = cardReducer(madeState(), { type: 'template/start' })
      const next = cardReducer(pending, {
        type: 'template/ack',
        detail: 'template download complete',
      })
      expect(next.templateActions.download).toEqual({
        status: 'ok',
        detail: 'template download complete',
      })
    })

    it('a late template/ack after a timeout is a no-op', () => {
      const pending = cardReducer(madeState(), { type: 'template/start' })
      const timedOut = cardReducer(pending, { type: 'template/timeout' })
      expect(timedOut.templateActions.download).toEqual({
        status: 'error',
        detail: ACTION_TIMEOUT_DETAIL,
      })
      const late = cardReducer(timedOut, { type: 'template/ack', detail: 'late' })
      expect(late).toBe(timedOut)
    })

    it('template/fail settles a pending cell to error', () => {
      const pending = cardReducer(madeState(), { type: 'template/start' })
      const next = cardReducer(pending, {
        type: 'template/fail',
        detail: 'template download failed',
      })
      expect(next.templateActions.download).toEqual({
        status: 'error',
        detail: 'template download failed',
      })
    })
  })

  describe('launch/move', () => {
    it('delegates to launchNextState and stamps the startTime', () => {
      const now = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const state = madeState()
      const next = cardReducer(state, {
        type: 'launch/move',
        providerId: 'p1',
        event: { type: 'start' },
      })
      expect(next.launch.p1).toEqual({ status: 'prereqs', startTime: now })
    })

    it('prices a provider with no entry as idle (a summary-running provider can stop)', () => {
      const state = madeState()
      const next = cardReducer(state, {
        type: 'launch/move',
        providerId: 'p2',
        event: { type: 'stop' },
      })
      expect(next.launch.p2?.status).toBe('stopping')
    })

    it('reads the current entry so a late event prices the state it lands on', () => {
      const started = cardReducer(madeState(), {
        type: 'launch/move',
        providerId: 'p3',
        event: { type: 'start' },
      })
      const next = cardReducer(started, {
        type: 'launch/move',
        providerId: 'p3',
        event: { type: 'healthy' },
      })
      expect(next.launch.p3?.status).toBe('running')
    })

    it('leaves the other provider entries untouched', () => {
      const withA = cardReducer(madeState(), {
        type: 'launch/move',
        providerId: 'a',
        event: { type: 'start' },
      })
      const next = cardReducer(withA, {
        type: 'launch/move',
        providerId: 'b',
        event: { type: 'start' },
      })
      expect(next.launch.a?.status).toBe('prereqs')
      expect(next.launch.b?.status).toBe('prereqs')
    })
  })

  describe('notes and ui', () => {
    it('note/set stores the note for the key', () => {
      const next = cardReducer(madeState(), { type: 'note/set', key: 'copy', note: 'copied' })
      expect(next.notes.copy).toBe('copied')
    })

    it('note/clear blanks the note for the key', () => {
      const state = madeState({ notes: { deps: '', copy: 'copied' } })
      const next = cardReducer(state, { type: 'note/clear', key: 'copy' })
      expect(next.notes.copy).toBe('')
    })

    it('ui/patch merges the patch over the ui state', () => {
      const state = madeState()
      const next = cardReducer(state, {
        type: 'ui/patch',
        patch: {
          providerFormMode: 'editing',
          editingProviderId: 'p1',
          logs: { liveLogs: 'tail', height: 200, scrollMode: 'manual' },
        },
      })
      expect(next.ui.providerFormMode).toBe('editing')
      expect(next.ui.editingProviderId).toBe('p1')
      expect(next.ui.logs).toEqual({ liveLogs: 'tail', height: 200, scrollMode: 'manual' })
      // Unpatched ui fields are preserved.
      expect(next.ui.help).toBe(true)
    })

    it('initialCardState starts getProgress at null', () => {
      expect(initialCardState().ui.getProgress).toBeNull()
    })

    it('ui/patch updates the getProgress field', () => {
      const progress: GetProgressState = {
        step: 'Downloading x.safetensors',
        percent: 42,
        doneBytes: 5.2e9,
        totalBytes: 43.5e9,
        etaSeconds: 611,
        unit: 'bytes',
      }
      const next = cardReducer(madeState(), { type: 'ui/patch', patch: { getProgress: progress } })
      expect(next.ui.getProgress).toEqual(progress)
      // Unpatched ui fields are preserved.
      expect(next.ui.help).toBe(true)
    })
  })

  it('leaves the state untouched for an unknown action', () => {
    const state = madeState()
    const next = cardReducer(state, { type: 'bogus' } as never)
    expect(next).toBe(state)
  })
})
