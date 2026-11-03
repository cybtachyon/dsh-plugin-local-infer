import * as reactModule from 'react'
import type { ChatTemplateStatusModel, LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ChatTemplateField,
  ChatTemplateStatusRow,
  useChatTemplateAutoDownload,
  type ChatTemplateFieldControl,
  type ChatTemplateFieldField,
} from '../src/render/ChatTemplateField.tsx'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type ActionState, type CardState } from '../src/store/types.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
import { TEXT } from '../src/text.ts'

// A renderer returns a React element (a plain object). The tests drive the
// element's event handlers without a renderer, so no react-dom is needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El
// children flattens the element's children (a single child or an array),
// dropping the null entries a JSX conditional branch ({cond ? el : null})
// emits into the array.
function children(e: El): El[] {
  const c = e.props.children
  if (c === undefined || c === null) {
    return []
  }
  return (Array.isArray(c) ? c : [c])
    .filter((x): x is unknown => x !== null && x !== undefined)
    .map(el)
}

// The react internals the hook dispatcher stub plugs into. React 18's hooks
// are thin wrappers that delegate to ReactCurrentDispatcher.current, so a
// stub dispatcher drives the shim's hook delegates.
const dispatcherHolder = (
  reactModule as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher

function withDispatcher<T>(dispatcher: unknown, fn: () => T): T {
  const previous = dispatcherHolder.current
  dispatcherHolder.current = dispatcher
  try {
    return fn()
  } finally {
    dispatcherHolder.current = previous
  }
}

// The hook state a ChatTemplateField render drives: the custom-mode flag
// (useState). The stub mirrors React's semantics: the flag keeps its value
// across renders, and a setter updates it.
function makeDispatcher() {
  let customMode: boolean | undefined
  const dispatcher = {
    useState: (initial: unknown) => {
      if (customMode === undefined) {
        customMode = initial as boolean
      }
      return [
        customMode,
        (update: boolean | ((prev: boolean) => boolean)) => {
          customMode =
            typeof update === 'function' ? (update as (prev: boolean) => boolean)(customMode as boolean) : update
        },
      ]
    },
    useRef: (initialValue: unknown) => ({ current: initialValue }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return { dispatcher, getCustomMode: () => customMode as boolean }
}

// The effect-capturing dispatcher the auto-download hook tests drive: the
// stub records the effect the hook arms and the test fires it on demand.
function makeEffectDispatcher() {
  let effect: (() => void) | null = null
  const dispatcher = {
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initialValue: unknown) => ({ current: initialValue }),
    useEffect: (effectFn: () => void) => {
      effect = effectFn
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return { dispatcher, runEffect: () => effect?.() }
}

// makeStore builds a test store over the real reducer.
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
  return store
}

// summaryWith builds the minimal summary the hook reads: the engine id, the
// config, and the chat-template status.
function summaryWith(chatTemplateStatus: ChatTemplateStatusModel | null): LocalInferSummary {
  return {
    engineId: 'ninfer',
    config: { modelDirectory: '/models' },
    chatTemplateStatus,
  } as unknown as LocalInferSummary
}

// jsonFetch stubs the global fetch with a JSON answer and records the
// request, so the test reads the body the driver posts.
function jsonFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, fetchMock }
}

// The onValue spy: every commit a render pushes into the draft.
function spyOnValue() {
  const calls: Array<[string, string | undefined]> = []
  return {
    calls,
    onValue: (key: string, value: string | undefined) => {
      calls.push([key, value])
    },
  }
}

function renderField(
  dispatcher: unknown,
  field: ChatTemplateFieldField,
  control: ChatTemplateFieldControl,
  onValue: (key: string, value: string | undefined) => void,
): El {
  return withDispatcher(dispatcher, () =>
    el(ChatTemplateField({ field, control, onValue, t: TEXT.en })),
  )
}

// The preset select a render draws (the native fallback; the tests wire no
// primitives seed).
function selectOf(outer: El): El {
  const row = children(outer)[0]
  return children(row).find((c) => c.type === 'select') as El
}

// The selected option's text: the native fallback carries no label prop
// (the label is the SelectPill's), so the test reads the option the select's
// value points at.
function selectedLabelOf(select: El): string | undefined {
  const option = children(select).find((o) => o.props.value === select.props.value)
  return option?.props.children as string | undefined
}

// The native select's onChange takes the event, not the id.
function selectChange(select: El, id: string): void {
  ;(select.props.onChange as (ev: { target: { value: string } }) => void)({
    target: { value: id },
  })
}

// The row's label element, the one that associates with the control.
function labelOf(row: El): El | undefined {
  return children(row).find((c) => c.type === 'label')
}

// The custom text input a render draws, absent while the custom mode is off.
function customInputOf(outer: El): El | undefined {
  const row = children(outer)[1]
  if (row === undefined) {
    return undefined
  }
  return children(row).find((c) => c.type === 'input')
}

const PRESET_OPTIONS: ChatTemplateFieldControl = {
  options: [
    { value: 'chatml', label: 'ChatML' },
    { value: 'llama', label: 'Llama', note: '3.1' },
  ],
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the chat-template field (render/ChatTemplateField.tsx)', () => {
  it('renders the preset select with the preset label and no custom row for a preset value', () => {
    const { dispatcher } = makeDispatcher()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: 'chatml' }, PRESET_OPTIONS, () => {})
    const select = selectOf(outer)
    expect(select.props.value).toBe('chatml')
    expect(selectedLabelOf(select)).toBe('ChatML')
    // The label association: the row's label carries the select's id through
    // htmlFor, so a screen reader names the control from the label.
    expect(select.props.id).toBe('dsh-li-chatTemplate')
    expect(labelOf(children(outer)[0])?.props.htmlFor).toBe('dsh-li-chatTemplate')
    // The items: the blank row, the presets (the note after a middle dot),
    // and the Custom entry.
    const items = children(select)
    expect(items).toHaveLength(4)
    expect(items.map((i) => i.props.children)).toEqual([
      'engine default',
      'ChatML',
      'Llama · 3.1',
      'Custom',
    ])
    expect(customInputOf(outer)).toBeUndefined()
  })

  it('renders the blank row for an empty value', () => {
    const { dispatcher } = makeDispatcher()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: undefined }, PRESET_OPTIONS, () => {})
    const select = selectOf(outer)
    expect(select.props.value).toBe('')
    expect(selectedLabelOf(select)).toBe('engine default')
    expect(customInputOf(outer)).toBeUndefined()
  })

  it('opens the custom row for a non-preset value', () => {
    const { dispatcher } = makeDispatcher()
    const outer = renderField(
      dispatcher,
      { key: 'chatTemplate', value: 'my-repo/tpl' },
      PRESET_OPTIONS,
      () => {},
    )
    const select = selectOf(outer)
    expect(select.props.value).toBe('custom')
    expect(selectedLabelOf(select)).toBe('Custom')
    const input = customInputOf(outer)
    expect(input?.props.value).toBe('my-repo/tpl')
    // The custom row's label associates with the text input the same way.
    expect(input?.props.id).toBe('dsh-li-chatTemplate-custom')
    expect(labelOf(children(outer)[1])?.props.htmlFor).toBe('dsh-li-chatTemplate-custom')
  })

  it('selecting custom from a preset clears the value and opens the row', () => {
    const { dispatcher, getCustomMode } = makeDispatcher()
    const spy = spyOnValue()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: 'chatml' }, PRESET_OPTIONS, spy.onValue)
    selectChange(selectOf(outer), 'custom')
    expect(spy.calls).toEqual([['chatTemplate', '']])
    expect(getCustomMode()).toBe(true)
    // The draft now carries the cleared value, so the re-render reads it.
    const second = renderField(dispatcher, { key: 'chatTemplate', value: '' }, PRESET_OPTIONS, spy.onValue)
    expect(customInputOf(second)?.props.value).toBe('')
  })

  it('selecting custom with a custom value keeps it', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: 'my-repo/tpl' }, PRESET_OPTIONS, spy.onValue)
    selectChange(selectOf(outer), 'custom')
    expect(spy.calls).toEqual([])
  })

  it('selecting the blank row commits undefined and closes the row', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: 'my-repo/tpl' }, PRESET_OPTIONS, spy.onValue)
    selectChange(selectOf(outer), '')
    expect(spy.calls).toEqual([['chatTemplate', undefined]])
    const second = renderField(dispatcher, { key: 'chatTemplate', value: undefined }, PRESET_OPTIONS, spy.onValue)
    expect(customInputOf(second)).toBeUndefined()
    expect(selectOf(second).props.value).toBe('')
  })

  it('selecting a preset commits its id and closes the row', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: 'my-repo/tpl' }, PRESET_OPTIONS, spy.onValue)
    selectChange(selectOf(outer), 'llama')
    expect(spy.calls).toEqual([['chatTemplate', 'llama']])
    const second = renderField(dispatcher, { key: 'chatTemplate', value: 'llama' }, PRESET_OPTIONS, spy.onValue)
    expect(customInputOf(second)).toBeUndefined()
    expect(selectOf(second).props.value).toBe('llama')
  })

  it('typing in the custom row commits the text', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    // Enter the custom mode from the blank row: the selection clears the
    // value and opens the row, the re-render reads the cleared value.
    const first = renderField(dispatcher, { key: 'chatTemplate', value: undefined }, PRESET_OPTIONS, spy.onValue)
    selectChange(selectOf(first), 'custom')
    const second = renderField(dispatcher, { key: 'chatTemplate', value: '' }, PRESET_OPTIONS, spy.onValue)
    ;(customInputOf(second)?.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'a-repo/tpl' },
    })
    expect(spy.calls).toEqual([
      ['chatTemplate', ''],
      ['chatTemplate', 'a-repo/tpl'],
    ])
  })

  it('the disabled flag greys the select and the custom input', () => {
    const { dispatcher } = makeDispatcher()
    const outer = renderField(
      dispatcher,
      { key: 'chatTemplate', value: 'my-repo/tpl', disabled: true },
      PRESET_OPTIONS,
      () => {},
    )
    expect(selectOf(outer).props.disabled).toBe(true)
    const input = customInputOf(outer)
    expect(input?.props.disabled).toBe(true)
    expect((input?.props.style as Record<string, unknown>).opacity).toBe(0.5)
  })

  it('a missing options list offers only the blank and custom rows', () => {
    const { dispatcher } = makeDispatcher()
    const outer = renderField(dispatcher, { key: 'chatTemplate', value: undefined }, {}, () => {})
    expect(children(selectOf(outer))).toHaveLength(2)
  })
})

// The absent-template status the hint and the auto-download tests drive.
const STATUS: ChatTemplateStatusModel = {
  repo: 'a-repo',
  label: 'a-repo',
  present: false,
  hfCli: true,
  downloadCommand: 'hf download a-repo',
}

describe('the absent-template hint (render/ChatTemplateField.tsx ChatTemplateStatusRow)', () => {
  function renderRow(status: ChatTemplateStatusModel, cell: ActionState, onDownload: () => void): El | null {
    const { dispatcher } = makeDispatcher()
    return withDispatcher(dispatcher, () =>
      el(ChatTemplateStatusRow({ status, cell, onDownload, t: TEXT.en })),
    )
  }

  it('renders nothing for a present template', () => {
    expect(renderRow({ ...STATUS, present: true }, { status: 'idle', detail: '' }, () => {})).toBeNull()
  })

  it('names the command and offers the Download button with the hf CLI', () => {
    const outer = renderRow(STATUS, { status: 'idle', detail: '' }, () => {})
    const row = children(outer as El)[0]
    const span = children(row)[0]
    expect(span.props.children).toBe('HF CLI detected: hf download a-repo')
    const button = children(row).find((c) => c.type === 'button')
    expect(button?.props.children).toBe('Download template')
    // renderProcessButton passes disabled: opts.disabled === true, so the
    // idle button reads false, not undefined.
    expect(button?.props.disabled).toBe(false)
  })

  it('shows the busy button while the cell is pending', () => {
    const outer = renderRow(STATUS, { status: 'pending', detail: '' }, () => {})
    const row = children(outer as El)[0]
    const button = children(row).find((c) => c.type === 'button')
    expect(button?.props.disabled).toBe(true)
    expect(button?.props['aria-label']).toBe('downloading template...')
  })

  it('shows the command as copyable text without the CLI', () => {
    const outer = renderRow(
      { ...STATUS, hfCli: false },
      { status: 'idle', detail: '' },
      () => {},
    )
    const row = children(outer as El)[0]
    const span = children(row)[0]
    expect(span.props.children).toBe('No HF CLI detected, url: hf download a-repo')
    expect(children(row).find((c) => c.type === 'button')).toBeUndefined()
  })

  it('maps an ok cell to the localized success note', () => {
    const outer = renderRow(STATUS, { status: 'ok', detail: 'ok' }, () => {})
    const note = children(outer as El)[1]
    expect(note?.props.children).toBe('template download complete')
  })

  it('maps an error cell to the localized failure note with the detail', () => {
    const outer = renderRow(STATUS, { status: 'error', detail: 'no such repo' }, () => {})
    const note = children(outer as El)[1]
    expect(note?.props.children).toBe('template download failed: no such repo')
  })

  it('renders no note while the cell is idle', () => {
    const outer = renderRow(STATUS, { status: 'idle', detail: '' }, () => {})
    expect(children(outer as El)[1]).toBeUndefined()
  })
})

describe('the auto-download effect (render/ChatTemplateField.tsx useChatTemplateAutoDownload)', () => {
  function renderHook(store: CardStore) {
    const { dispatcher, runEffect } = makeEffectDispatcher()
    withDispatcher(dispatcher, () => useChatTemplateAutoDownload(store))
    return runEffect
  }

  it('fires the download for an absent template the CLI can pull', async () => {
    const store = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith(STATUS) })
    const { calls, fetchMock } = jsonFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(store)()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/local-infer/chat-template')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      engine: 'ninfer',
      template: 'a-repo',
      directory: '/models',
    })
    expect(store.getSnapshot().templateActions.download.status).toBe('pending')
    vi.unstubAllGlobals()
  })

  it('skips a present template', () => {
    const store = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith({ ...STATUS, present: true }) })
    const { fetchMock } = jsonFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(store)()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('skips when the CLI is absent', () => {
    const store = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith({ ...STATUS, hfCli: false }) })
    const { fetchMock } = jsonFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(store)()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('skips an empty repo', () => {
    const store = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith({ ...STATUS, repo: '' }) })
    const { fetchMock } = jsonFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(store)()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('does not double-fire while a download is in flight', () => {
    const store = makeStore()
    store.dispatch({ type: 'summary/ack', summary: summaryWith(STATUS) })
    store.dispatch({ type: 'template/start' })
    const { fetchMock } = jsonFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(store)()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
