import { beforeEach, describe, expect, it } from 'vitest'
import type { LocalInferSummary, ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui'
import { clearInFlightRuns, trackGetAbort } from '../src/store/abort.ts'
import {
  deriveDisplayedLogs,
  deriveLaunchDisabled,
  deriveLifecycleControl,
  deriveProviderFormMode,
  formatProgressReadout,
  isGettingInFlight,
} from '../src/store/derive.ts'
import type { GetProgressState } from '../src/store/progress.ts'
import {
  initialCardState,
  type CardState,
  type LaunchStoreEntry,
} from '../src/store/types.ts'
import { TEXT, type TextTable } from '../src/text.ts'

const t: TextTable = TEXT.en

// makeProvider builds a provider summary entry the lifecycle tests edit.
function makeProvider(id: string): ProviderSummaryEntry {
  return {
    id,
    engine: 'ninfer',
    model: 'm',
    status: 'stopped',
    config: {},
    platform: {},
  } as ProviderSummaryEntry
}

// makeSummary builds a summary carrying the named providers.
function makeSummary(providerIds: string[] = []): LocalInferSummary {
  return { providers: providerIds.map(makeProvider) } as LocalInferSummary
}

// makeState builds a CardState over the initial state with a summary and the
// named providers in place, the shape the card has after its first summary ack.
function makeState(
  providerIds: string[] = [],
  overrides: Partial<CardState> = {},
): CardState {
  return {
    ...initialCardState(),
    summary: makeSummary(providerIds),
    ...overrides,
  }
}

// launchEntry builds a machine entry for a provider at the named status.
function launchEntry(
  status: LaunchStoreEntry['status'],
  cause: LaunchStoreEntry['cause'] = undefined,
): LaunchStoreEntry {
  return { status, cause, startTime: 0 }
}

// editingUi patches the ui state to edit the named provider.
function editingUi(providerId: string | null): CardState['ui'] {
  return { ...initialCardState().ui, editingProviderId: providerId }
}

// barState builds a GetProgressState the way the parser folds a byte bar.
function barState(): GetProgressState {
  return {
    step: 'Downloading m.safetensors',
    percent: 42,
    doneBytes: 43.2e9,
    totalBytes: 102.4e9,
    etaSeconds: 751,
    unit: 'bytes',
  }
}

// filesState builds a GetProgressState the way the parser folds a file-count bar.
function filesState(): GetProgressState {
  return {
    step: 'Fetching 102 files',
    percent: 42,
    doneBytes: 43,
    totalBytes: 102,
    etaSeconds: 2,
    unit: 'files',
  }
}

// The in-flight Get registry is module state: a clean registry keeps the
// getting-branch tests from reading a run the other tests never started.
beforeEach(() => {
  clearInFlightRuns()
})

describe('client store derive (store/derive.ts)', () => {
  describe('deriveLifecycleControl', () => {
    describe('phase throbber (the edited provider is mid-lifecycle)', () => {
      const cases: Array<[LaunchStoreEntry['status'], string]> = [
        ['prereqs', t.entryPrereqs],
        ['download', t.entryDownloading],
        ['downloading', t.entryDownloading],
        ['build', t.entryBuilding],
        ['launch', t.entryLaunching],
        ['stopping', t.stopping],
      ]
      for (const [status, label] of cases) {
        it(`renders a busy throbber with the ${status} label`, () => {
          const state = makeState(['p1'], {
            launch: { p1: launchEntry(status) },
            ui: editingUi('p1'),
          })
          expect(deriveLifecycleControl(state, t)).toEqual({
            kind: 'phase',
            label,
            variant: 'ghost',
            busy: true,
            busyLabel: label,
            disabled: false,
            target: 'entry',
            action: 'none',
          })
        })
      }
    })

    it('renders a ghost Stop when the edited provider is running', () => {
      const state = makeState(['p1'], {
        launch: { p1: launchEntry('running') },
        ui: editingUi('p1'),
      })
      expect(deriveLifecycleControl(state, t)).toEqual({
        kind: 'stop',
        label: t.stop,
        variant: 'ghost',
        busy: false,
        busyLabel: '',
        disabled: false,
        target: 'entry',
        action: 'stop',
      })
    })

    it('renders a red Logs when the edited provider failed', () => {
      const state = makeState(['p1'], {
        launch: { p1: launchEntry('failed', 'stop') },
        ui: editingUi('p1'),
      })
      expect(deriveLifecycleControl(state, t)).toEqual({
        kind: 'logs',
        label: t.entryLogs,
        variant: 'ghost',
        busy: false,
        busyLabel: '',
        disabled: false,
        target: 'entry',
        action: 'logs',
      })
    })

    describe('fresh provider (no machine entry, draft action cells)', () => {
      it('shows a busy Launch throbber while the launch is pending', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'pending', detail: '' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'launchStop',
          label: t.launch,
          variant: 'primary',
          busy: true,
          busyLabel: t.launching,
          disabled: false,
          target: 'draft',
          action: 'launch',
        })
      })

      it('shows a busy Stop throbber while the stop is pending', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            stop: { status: 'pending', detail: '' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'launchStop',
          label: t.launch,
          variant: 'primary',
          busy: true,
          busyLabel: t.stopping,
          disabled: false,
          target: 'draft',
          action: 'launch',
        })
      })

      it('reads as running (ghost Stop) once the launch settled ok', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'ok', detail: 'launched' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'launchStop',
          label: t.stop,
          variant: 'ghost',
          busy: false,
          busyLabel: '',
          disabled: false,
          target: 'draft',
          action: 'stop',
        })
      })

      it('reads as running even when the stop timed out (engine probably up)', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'ok', detail: 'launched' },
            stop: { status: 'error', detail: 'timeout' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toMatchObject({
          label: t.stop,
          action: 'stop',
        })
      })

      it('reads as not running (primary Launch) once the stop settled ok', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'ok', detail: 'launched' },
            stop: { status: 'ok', detail: 'stopped' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'launchStop',
          label: t.launch,
          variant: 'primary',
          busy: false,
          busyLabel: '',
          disabled: false,
          target: 'draft',
          action: 'launch',
        })
      })
    })

    it('routes an edited provider at idle to the entry launch', () => {
      const state = makeState(['p1'], {
        launch: { p1: launchEntry('idle') },
        ui: editingUi('p1'),
      })
      expect(deriveLifecycleControl(state, t)).toEqual({
        kind: 'launchStop',
        label: t.launch,
        variant: 'primary',
        busy: false,
        busyLabel: '',
        disabled: false,
        target: 'entry',
        action: 'launch',
      })
    })

    it('falls back to the draft when the edited id no longer resolves', () => {
      // editingProviderId names a provider the summary no longer carries.
      const state = makeState(['p1'], { ui: editingUi('gone') })
      expect(deriveLifecycleControl(state, t)).toMatchObject({
        target: 'draft',
        action: 'launch',
      })
    })

    describe('getting throbber (a Get run is in flight)', () => {
      it('renders a busy throbber with the live readout while the get cell is pending', () => {
        const progress = barState()
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            get: { status: 'pending', detail: '' },
          },
          ui: { ...initialCardState().ui, editingProviderId: null, getProgress: progress },
        })
        const readout = 'Downloading… 42% · 43.2/102.4 GB · ETA 12:31'
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'getting',
          label: readout,
          variant: 'ghost',
          busy: true,
          busyLabel: readout,
          disabled: false,
          target: 'draft',
          action: 'none',
          progress,
        })
      })

      it('renders the plain fallback label while no progress state has landed', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            get: { status: 'pending', detail: '' },
          },
          ui: { ...initialCardState().ui, editingProviderId: null, getProgress: null },
        })
        expect(deriveLifecycleControl(state, t)).toEqual({
          kind: 'getting',
          label: t.gettingReadout,
          variant: 'ghost',
          busy: true,
          busyLabel: t.gettingReadout,
          disabled: false,
          target: 'draft',
          action: 'none',
          progress: null,
        })
      })

      it('renders the getting throbber while the in-flight registry reads true after the idle cap settled the cell', () => {
        trackGetAbort(new AbortController())
        const state = makeState([], { ui: editingUi(null) })
        expect(deriveLifecycleControl(state, t)).toMatchObject({
          kind: 'getting',
          busy: true,
          progress: null,
        })
      })

      it('keeps the Stop side when the draft reads as running', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'ok', detail: 'launched' },
            get: { status: 'pending', detail: '' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toMatchObject({
          kind: 'launchStop',
          label: t.stop,
          action: 'stop',
          disabled: false,
        })
      })
    })

    describe('disabled gating (the launch side only)', () => {
      it('renders the getting throbber (not a disabled Launch) while a Get run is in flight', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            get: { status: 'pending', detail: '' },
          },
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toMatchObject({
          kind: 'getting',
          disabled: false,
        })
      })

      it('disables while the deps panel reports an unsatisfied dep', () => {
        const state = makeState([], {
          deps: { allSatisfied: false } as CardState['deps'],
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t).disabled).toBe(true)
      })

      it('enables when the deps are satisfied and no Get is in flight', () => {
        const state = makeState([], {
          deps: { allSatisfied: true } as CardState['deps'],
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t).disabled).toBe(false)
      })

      it('never disables the Stop side while running', () => {
        const state = makeState([], {
          actions: {
            ...initialCardState().actions,
            launch: { status: 'ok', detail: 'launched' },
            get: { status: 'pending', detail: '' },
          },
          deps: { allSatisfied: false } as CardState['deps'],
          ui: editingUi(null),
        })
        expect(deriveLifecycleControl(state, t)).toMatchObject({
          label: t.stop,
          action: 'stop',
          disabled: false,
        })
      })
    })
  })

  describe('formatProgressReadout', () => {
    it('renders the verb, percent, GB amounts, and ETA', () => {
      expect(formatProgressReadout(barState(), t)).toBe(
        'Downloading… 42% · 43.2/102.4 GB · ETA 12:31',
      )
    })

    it('renders a file-count state as a file count, not GB', () => {
      expect(formatProgressReadout(filesState(), t)).toBe(
        'Downloading… 42% · 43/102 files · ETA 0:02',
      )
    })

    it('drops the ETA segment when the bar carries no tail', () => {
      const state: GetProgressState = {
        step: 'Downloading m.safetensors',
        percent: 100,
        doneBytes: 102.4e9,
        totalBytes: 102.4e9,
        etaSeconds: 0,
        unit: 'bytes',
      }
      expect(formatProgressReadout(state, t)).toBe('Downloading… 100% · 102.4/102.4 GB')
    })
  })

  describe('deriveDisplayedLogs', () => {
    it('shows the streamed Get buffer while a run is in flight', () => {
      const state = makeState([], {
        ui: { ...initialCardState().ui, logs: { getLogs: 'stream', height: 96, scrollMode: 'scrolling' } },
      })
      expect(deriveDisplayedLogs(state)).toBe('stream')
    })

    it('falls back to the summary last-run logs when no stream is in flight', () => {
      const state = makeState([], { summary: makeSummary([]) })
      state.summary = { ...state.summary, lastLogs: 'persisted' } as LocalInferSummary
      expect(deriveDisplayedLogs(state)).toBe('persisted')
    })

    it('reads the empty string when there is no stream and no persisted logs', () => {
      const state = makeState([])
      expect(deriveDisplayedLogs(state)).toBe('')
    })

    it('reads the empty string with no summary and no stream', () => {
      const state = initialCardState()
      expect(deriveDisplayedLogs(state)).toBe('')
    })
  })

  describe('deriveProviderFormMode', () => {
    it('forces new mode when the summary has zero providers', () => {
      const state = makeState([], { ui: { ...initialCardState().ui, providerFormMode: 'collapsed' } })
      expect(deriveProviderFormMode(state)).toBe('new')
    })

    it('keeps the stored mode when the summary carries providers', () => {
      const state = makeState(['p1'], {
        ui: { ...initialCardState().ui, providerFormMode: 'editing' },
      })
      expect(deriveProviderFormMode(state)).toBe('editing')
    })

    it('keeps the stored mode with no summary', () => {
      const state = initialCardState()
      expect(deriveProviderFormMode(state)).toBe('collapsed')
    })
  })

  describe('deriveLaunchDisabled', () => {
    it('is disabled while a Get run is in flight', () => {
      const state = makeState([], {
        actions: {
          ...initialCardState().actions,
          get: { status: 'pending', detail: '' },
        },
      })
      expect(deriveLaunchDisabled(state)).toBe(true)
    })

    it('is disabled while the deps panel reports an unsatisfied dep', () => {
      const state = makeState([], { deps: { allSatisfied: false } as CardState['deps'] })
      expect(deriveLaunchDisabled(state)).toBe(true)
    })

    it('is enabled when the deps are satisfied and no Get is in flight', () => {
      const state = makeState([], { deps: { allSatisfied: true } as CardState['deps'] })
      expect(deriveLaunchDisabled(state)).toBe(false)
    })

    it('is enabled with no deps and no Get in flight', () => {
      expect(deriveLaunchDisabled(initialCardState())).toBe(false)
    })
  })

  describe('isGettingInFlight', () => {
    it('reads true while the get cell is pending', () => {
      const state = makeState([], {
        actions: {
          ...initialCardState().actions,
          get: { status: 'pending', detail: '' },
        },
      })
      expect(isGettingInFlight(state)).toBe(true)
    })

    it('reads true while the in-flight registry carries a run after the idle cap settled the cell', () => {
      trackGetAbort(new AbortController())
      expect(isGettingInFlight(makeState([]))).toBe(true)
    })

    it('reads false with no pending cell and no registered run', () => {
      expect(isGettingInFlight(makeState([]))).toBe(false)
    })
  })
})
