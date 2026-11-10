import * as reactModule from 'react'
import type { DepsModel, LocalInferSummary } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { card, type LocaleRef } from '../src/Card.tsx'
import {
  setReactModule,
  type CardStoreInstance,
  type ReactLike,
} from '../src/store/useCardStore.ts'
import { clearInFlightRuns, trackGetAbort } from '../src/store/abort.ts'
import type { CardDraft } from '../src/store/types.ts'
import { PRIMARY_BUTTON, SUDO_STATE_LABEL_COLOR } from '../src/styles.ts'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// A locale service the card reads through useSyncExternalStore: getSnapshot
// hands back the active locale id and subscribe is a no-op (the card tests do
// not switch locales mid-render).
function localeRef(active: string): LocaleRef {
  return {
    current: {
      getSnapshot: () => ({ active }),
      subscribe: () => () => {},
    },
  }
}

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props?: Record<string, unknown> }

// The dispatcher a tree walk plugs into when it renders a component element
// (a function type): a stateless stub whose useState hands back the initial
// value and whose useRef hands back a fresh ref, so a walk sees a component's
// output (a NumberField's input, a ChatTemplateField's select) without a
// mount.
const walkDispatcher = {
  useState: (initial: unknown) => [initial, () => {}],
  useRef: (initialValue: unknown) => ({ current: initialValue }),
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}

// renderThrough renders an element's own output: a component element (a
// function type) runs under the walk dispatcher and its return is the
// element's content, a host element reads its children prop.
function contentOf(e: El): unknown {
  if (typeof e.type === 'function') {
    return withDispatcher(walkDispatcher, () =>
      (e.type as (props: Record<string, unknown>) => unknown)(e.props ?? {}),
    )
  }
  return e.props?.children
}

// text reads the element tree's text content, flattening strings, numbers,
// and nested element arrays (a JSX map array carries the rows).
function text(node: unknown): string {
  if (node === null || node === undefined) {
    return ''
  }
  if (typeof node !== 'object') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map((x) => text(x)).join('')
  }
  const c = contentOf(node as El)
  if (c === undefined || c === null) {
    return ''
  }
  const list = Array.isArray(c) ? c : [c]
  return list.map((x) => text(x)).join('')
}
// children flattens the element's children (a single child, an array, or a
// nested JSX map array), dropping the null entries a conditional emits. A
// component element renders through the walk dispatcher first, so its inner
// controls stay reachable.
function children(e: El): El[] {
  const c = contentOf(e)
  if (c === undefined || c === null) {
    return []
  }
  const list = Array.isArray(c) ? c : [c]
  return list
    .flatMap((x): unknown => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]))
    .filter((x): x is unknown => x !== null && x !== undefined)
    .map((x) => x as El)
}
// findAll walks the element tree and collects every element matching the
// predicate, in render order.
function findAll(node: unknown, pred: (e: El) => boolean): El[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return []
  }
  const e = node as El
  const own = pred(e) ? [e] : []
  return [...own, ...children(e).flatMap((c) => findAll(c, pred))]
}
function find(node: unknown, pred: (e: El) => boolean): El | undefined {
  return findAll(node, pred)[0]
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

// The dispatcher the card tests drive: it records the refs (the store ref,
// the draft ref, the re-price timer) and the effects, so a test reads the
// store and fires the effects and the unmount cleanup.
function makeDispatcher() {
  const refs: Array<{ current: unknown }> = []
  const effects: Array<() => void | (() => void)> = []
  let refCallIndex = 0
  const dispatcher = {
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initialValue: unknown) => {
      const index = refCallIndex
      refCallIndex += 1
      if (refs[index] === undefined) {
        refs[index] = { current: initialValue }
      }
      return refs[index]
    },
    useEffect: (effectFn: () => void | (() => void)) => {
      effects.push(effectFn)
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return {
    dispatcher,
    getRef: (i: number) => refs[i],
    runEffects: () => {
      for (const effect of effects) {
        effect()
      }
    },
    // Run each effect's cleanup (the unmount path), the way React does.
    runCleanups: () => {
      for (const effect of effects) {
        const cleanup = effect()
        if (typeof cleanup === 'function') {
          cleanup()
        }
      }
    },
    // Reset the ref call index between renders (the hooks run in the same
    // order, so the same index maps to the same ref).
    resetForRerender: () => {
      refCallIndex = 0
    },
  }
}

// fullSummary builds a summary that exercises the card's branches: the form
// fields (every control kind), the model rows, the meter, and the optional
// banner / status / verdict cells the tests toggle.
function fullSummary(patch: Partial<LocalInferSummary> = {}): LocalInferSummary {
  const base: LocalInferSummary = {
    engineId: 'ninfer',
    config: { model: 'a-model' },
    providers: [],
    lastLogs: '',
    engines: [
      {
        id: 'ninfer',
        label: 'NInfer',
        supports: { docker: true, local: true },
        defaultBuildCommand: 'make ninfer',
        defaultDockerTag: 'ninfer:latest',
      },
    ],
    models: [{ id: 'a-model', source: 'local' }],
    formModel: {
      sections: [
        {
          group: 'General',
          fields: [
            {
              key: 'flag',
              label: 'Flag',
              description: 'a flag',
              group: 'General',
              control: { kind: 'checkbox' },
              value: true,
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'enum',
              label: 'Enum',
              description: 'an enum',
              group: 'General',
              control: {
                kind: 'dropdown',
                options: [
                  { value: 'a', label: 'A' },
                  { value: 'b', label: 'B', note: 'the b note' },
                ],
              },
              value: 'a',
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'num',
              label: 'Num',
              description: 'a number',
              group: 'General',
              control: { kind: 'slider', min: 0, max: 10, step: 1, unit: 'GB' },
              value: 5,
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'port',
              label: 'Port',
              description: 'a port',
              group: 'General',
              control: { kind: 'slider', min: 1, max: 65535, slider: false },
              value: 8080,
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'template',
              label: 'Template',
              description: 'a template',
              group: 'General',
              control: {
                kind: 'combo',
                options: [
                  { value: 'preset1', label: 'Preset 1' },
                  { value: 'custom', label: 'Custom' },
                ],
              },
              value: 'preset1',
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'path',
              label: 'Path',
              description: 'a path',
              group: 'General',
              control: { kind: 'text', placeholder: 'type a path' },
              value: '/tmp',
              disabled: false,
              disabledReason: null,
            },
            {
              key: 'dir',
              label: 'Dir',
              description: 'a dir',
              group: 'General',
              control: { kind: 'picker' },
              value: '/models',
              disabled: false,
              disabledReason: null,
            },
          ],
        },
      ],
    },
    meterModel: { source: 'not-measured', segments: [], unknownEngines: null },
    verdict: null,
    warningsModel: {
      banner: { visible: false, level: null, count: 0, warnings: [] },
      inline: {},
    },
    ...patch,
  } as unknown as LocalInferSummary
  return base
}

// The draft the full-card tests bind the fields to.
function fullDraft(): CardDraft {
  return {
    engine: 'ninfer',
    config: {
      flag: true,
      enum: 'a',
      num: 5,
      port: 8080,
      template: 'preset1',
      path: '/tmp',
      dir: '/models',
      modelDirectory: '/mdl',
      model: 'a-model',
      buildMode: 'local',
    },
    platform: { ninfer: { engineDirectory: '/eng' } },
  }
}

// depsAnswer builds the /local-infer/deps answer the card's re-prices ack:
// the full satisfied-empty DepsModel shape. The DepsPanel renders the acked
// model on every later re-render, so a partial stub would crash it.
function depsAnswer(): DepsModel {
  return {
    engineId: 'ninfer',
    buildMode: 'local',
    packageManager: null,
    deps: [],
    allSatisfied: true,
    installString: '',
    runAllowed: false,
  }
}

// autoRebuildBox locates the Auto Rebuild checkbox's input. The control-row
// checkboxes (Auto Rebuild, the agent-default box next to Register) and the
// form's checkbox fields all render the same input[type=checkbox], so
// indexing the tree (the pattern the field-edit tests use) would shift with
// any field change; this walks from the one label whose whole text is the
// Auto Rebuild copy to its input, a pin that travels with the control.
function autoRebuildBox(tree: unknown): El {
  const label = find(tree, (e) => e.type === 'label' && text(e) === t.autoRebuild)
  expect(label).toBeDefined()
  const box = find(label, (e) => e.type === 'input' && e.props?.type === 'checkbox')
  expect(box).toBeDefined()
  return box as El
}

// clickBox fires a native checkbox input's onChange with the next checked
// value (the card tests' existing checkbox-dispatch pattern).
function clickBox(box: El, next: boolean): void {
  ;(box.props?.onChange as (ev: { target: { checked: boolean } }) => void)({
    target: { checked: next },
  })
}

// fieldCheckbox locates a checkbox form field's input by its field label.
// renderField draws the row as a label element plus the bare native input
// (unlike renderCheckbox's label-nested control that autoRebuildBox walks),
// so this walks from the row div holding the one label whose whole text is
// the field label to the checkbox in that row. Same pin-travels-with-the-
// control rule as autoRebuildBox: indexing the checkbox tree would shift
// with any field change.
function fieldCheckbox(tree: unknown, fieldLabel: string): El {
  const row = find(
    tree,
    (e) =>
      e.type === 'div' &&
      children(e).some((c) => c.type === 'label' && text(c) === fieldLabel),
  )
  expect(row).toBeDefined()
  const box = find(row, (e) => e.type === 'input' && e.props?.type === 'checkbox')
  expect(box).toBeDefined()
  return box as El
}

// renderCard renders the card over a seeded store: the first render creates
// the per-mount store, the seed lands before the effects run (so the mount
// effect reads the seeded state and skips the initial fetch), and the
// re-render draws the full card.
function renderCard(opts: {
  summary?: LocalInferSummary
  draft?: CardDraft
  ui?: Record<string, unknown>
}) {
  const Component = card(null, localeRef('en'), null)
  const { dispatcher, getRef, runEffects, runCleanups, resetForRerender } = makeDispatcher()
  withDispatcher(dispatcher, () => {
    Component()
  })
  const store = (getRef(0) as { current: CardStoreInstance | null }).current
  expect(store).not.toBe(null)
  if (opts.summary !== undefined) {
    store.dispatch({ type: 'summary/ack', summary: opts.summary })
  }
  if (opts.ui !== undefined) {
    store.dispatch({ type: 'ui/patch', patch: opts.ui })
  }
  if (opts.draft !== undefined) {
    store.dispatch({ type: 'draft/load', draft: opts.draft })
  }
  runEffects()
  resetForRerender()
  const tree = withDispatcher(dispatcher, () => Component())
  // Re-run the effects so the draft-mirror effect (which closes over the
  // re-render's draft, not the first render's null) updates its ref. The
  // debounced re-price reads that ref, so it must see the seeded draft.
  runEffects()
  return {
    tree,
    store,
    rerender: () => {
      resetForRerender()
      return withDispatcher(dispatcher, () => Component())
    },
    runCleanups,
  }
}

// routeFetch stubs the global fetch with a per-route answer table, recording
// the request init too so a test can read the posted body.
function routeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const path = url.split('?')[0]
    const factory = routes[path]
    if (factory === undefined) {
      return new Response(JSON.stringify({ error: 'no such route' }), { status: 404 })
    }
    return factory()
  })
  return { calls, fetchMock }
}

function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// launchStream builds a /local-infer/launch answer whose body streams NDJSON
// lines the test enqueues and closes by hand.
function launchStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: (): Response =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    enqueue: (line: string) => controller.enqueue(encoder.encode(line + '\n')),
    close: () => controller.close(),
  }
}

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the card composer (src/Card.tsx)', () => {
  it('the card factory returns a component', () => {
    const Component = card(null, localeRef('en'), null)
    expect(typeof Component).toBe('function')
  })

  it('renders the loading state while there is no summary and no draft', () => {
    const { tree, store } = renderCard({})
    expect(text(tree)).toBe(t.loading)
    expect(store.getSnapshot().summary).toBe(null)
  })

  it('renders the card frame with a summary and a draft', () => {
    const { tree } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    expect(text(tree)).toContain(t.section)
  })

  it('renders the full form: every control kind, the platform rows, and the control row', () => {
    const { tree } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    // The checkbox field (the first checkbox in the tree).
    const checkboxes = findAll(tree, (e) => e.type === 'input' && e.props?.type === 'checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(1)
    // The dropdown field (a native select bound to the draft value 'a').
    const enumSelect = find(tree, (e) => e.type === 'select' && e.props?.value === 'a')
    expect(enumSelect).toBeDefined()
    // The slider field (a range input bound to 5).
    const range = find(tree, (e) => e.type === 'input' && e.props?.type === 'range')
    expect(range).toBeDefined()
    // The slider:false field (a number input, no range strip).
    const number = find(tree, (e) => e.type === 'input' && e.props?.type === 'number')
    expect(number).toBeDefined()
    // The combo field (the preset select bound to 'preset1').
    const comboSelect = find(tree, (e) => e.type === 'select' && e.props?.value === 'preset1')
    expect(comboSelect).toBeDefined()
    // The text and picker fields (free-text inputs bound to their values).
    expect(find(tree, (e) => e.type === 'input' && e.props?.value === '/tmp')).toBeDefined()
    expect(find(tree, (e) => e.type === 'input' && e.props?.value === '/models')).toBeDefined()
    // The model directory and the platform engine directory rows.
    expect(find(tree, (e) => e.type === 'input' && e.props?.value === '/mdl')).toBeDefined()
    expect(find(tree, (e) => e.type === 'input' && e.props?.value === '/eng')).toBeDefined()
    // The control row carries the auto-rebuild checkbox and the register row.
    expect(text(tree)).toContain(t.autoRebuild)
    expect(text(tree)).toContain(t.register)
  })

  it('edits a field through onValue, dispatching a draft edit', () => {
    const { tree, store } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    const checkbox = fieldCheckbox(tree, 'Flag')
    ;(checkbox.props?.onChange as (ev: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    })
    expect(store.getSnapshot().draft?.config.flag).toBe(false)
    expect(store.getSnapshot().dirty).toBe(true)
  })

  it('toggles the Auto Rebuild checkbox into the draft, marking the form dirty', () => {
    const { tree, store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    // The draft carries no autoRebuild key: the checkbox draws unchecked.
    expect('autoRebuild' in (store.getSnapshot().draft ?? {})).toBe(false)
    expect(autoRebuildBox(tree).props?.checked).toBe(false)
    // Checking it dispatches draft/edit with the draft plus autoRebuild: an
    // unsaved change until Save writes it with the provider.
    clickBox(autoRebuildBox(tree), true)
    expect(store.getSnapshot().draft?.autoRebuild).toBe(true)
    expect(store.getSnapshot().dirty).toBe(true)
    const checked = rerender()
    expect(autoRebuildBox(checked).props?.checked).toBe(true)
    // Unchecking rides the same draft/edit path back to false: the draft
    // now carries an explicit false (the same representation a stored
    // false loads to), and the box redraws unchecked from it.
    clickBox(autoRebuildBox(checked), false)
    expect(store.getSnapshot().draft?.autoRebuild).toBe(false)
    expect(autoRebuildBox(rerender()).props?.checked).toBe(false)
  })

  it('shows each provider its own stored Auto Rebuild value when opened for editing', async () => {
    vi.useFakeTimers()
    try {
      // One entry stored with autoRebuild true, one stored without the key
      // (an entry saved before the key existed): each must show its own box.
      const summary = fullSummary({
        providers: [
          {
            id: 'p1',
            engine: 'ninfer',
            model: 'a-model',
            status: 'stopped',
            config: {},
            platform: {},
            autoRebuild: true,
          },
          {
            id: 'p2',
            engine: 'ninfer',
            model: 'a-model',
            status: 'stopped',
            config: {},
            platform: {},
          },
        ] as unknown as LocalInferSummary['providers'],
      })
      const { fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summary),
        // A satisfied empty deps plan: the edit's reprice acks it, and this
        // test re-renders after the ack.
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, store, rerender } = renderCard({ summary, draft: fullDraft() })
      // Open the first entry: its row's Edit loads the stored true, and the
      // checkbox renders from the loaded draft.
      const editBtns = findAll(tree, (e) => e.type === 'button' && text(e) === t.edit)
      expect(editBtns).toHaveLength(2)
      ;(editBtns[0].props?.onClick as () => void)()
      await flush()
      expect(store.getSnapshot().ui.editingProviderId).toBe('p1')
      expect(store.getSnapshot().draft?.autoRebuild).toBe(true)
      expect(autoRebuildBox(rerender()).props?.checked).toBe(true)
      // Open the second entry (the first row's control now reads Cancel, so
      // the one Edit button left is p2's): its stored entry carries no key,
      // so its box draws unchecked.
      const p2Edit = findAll(rerender(), (e) => e.type === 'button' && text(e) === t.edit)
      expect(p2Edit).toHaveLength(1)
      ;(p2Edit[0].props?.onClick as () => void)()
      await flush()
      expect(store.getSnapshot().ui.editingProviderId).toBe('p2')
      expect(store.getSnapshot().draft?.autoRebuild).toBe(false)
      expect(autoRebuildBox(rerender()).props?.checked).toBe(false)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('draws the Auto Rebuild checkbox unchecked on a fresh new-provider draft', () => {
    // No draft is dispatched: the summary ack seeds the new-provider draft,
    // which carries no autoRebuild key, and the box reads as unchecked.
    const { tree, store } = renderCard({ summary: fullSummary() })
    expect(store.getSnapshot().draft).not.toBe(null)
    expect('autoRebuild' in (store.getSnapshot().draft ?? {})).toBe(false)
    expect(autoRebuildBox(tree).props?.checked).toBe(false)
  })

  it('switches the engine through onEngine, resetting the config', () => {
    const { tree, store } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    const engineSelect = find(tree, (e) => e.type === 'select' && e.props?.value === 'ninfer')
    ;(engineSelect?.props?.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'strata' },
    })
    const draft = store.getSnapshot().draft
    expect(draft?.engine).toBe('strata')
    // The config resets to blank for the new engine.
    expect(draft?.config).toEqual({})
  })

  it('auto-fills the model from the first default when a directory is typed', () => {
    const summary = fullSummary({
      modelDefaults: [{ id: 'default-model', label: 'Default Model' }],
    })
    const draft = fullDraft()
    delete (draft.config as Record<string, unknown>).model
    const { tree, store } = renderCard({ summary, draft })
    const dirInput = find(tree, (e) => e.type === 'input' && e.props?.value === '/mdl')
    ;(dirInput?.props?.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '/new-dir' },
    })
    // The directory landed, and the blank model auto-filled from the default.
    expect(store.getSnapshot().draft?.config.modelDirectory).toBe('/new-dir')
    expect(store.getSnapshot().draft?.config.model).toBe('default-model')
  })

  it('edits a platform field through onPlatform, keeping the per-engine entry', () => {
    const { tree, store } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    const engDir = find(tree, (e) => e.type === 'input' && e.props?.value === '/eng')
    ;(engDir?.props?.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '/eng2' },
    })
    expect(store.getSnapshot().draft?.platform?.ninfer?.engineDirectory).toBe('/eng2')
  })

  it('routes the title-bar control to the draft launch and stop actions', () => {
    vi.useFakeTimers()
    try {
      const { tree, store } = renderCard({ summary: fullSummary(), draft: fullDraft() })
      // The control reads as a Launch (the draft is idle). Click it.
      const launchBtn = find(
        tree,
        (e) => e.type === 'button' && text(e) === t.launch,
      )
      expect(launchBtn).toBeDefined()
      ;(launchBtn?.props?.onClick as () => void)()
      expect(store.getSnapshot().actions.launch.status).toBe('pending')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('routes the edited provider title-bar Launch to its entry machine', async () => {
    vi.useFakeTimers()
    try {
      const summary = fullSummary({
        providers: [
          {
            id: 'p1',
            engine: 'ninfer',
            model: 'a-model',
            status: 'stopped',
            config: {},
            platform: {},
          },
        ] as unknown as LocalInferSummary['providers'],
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/logs': () =>
          new Response('{"snapshot":"","seq":0,"running":false}\n', {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
          }),
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, store } = renderCard({
        summary,
        draft: fullDraft(),
        ui: { editingProviderId: 'p1', providerFormMode: 'editing' },
      })
      // The title-bar control is the primary Launch (the provider row's own
      // Launch control is a ghost). Click it.
      const launchBtn = find(
        tree,
        (e) =>
          e.type === 'button' &&
          text(e) === t.launch &&
          (e.props?.style as Record<string, unknown> | undefined) === PRIMARY_BUTTON,
      )
      expect(launchBtn).toBeDefined()
      ;(launchBtn?.props?.onClick as () => void)()
      // The edited provider's click rides the entry driver: the machine (the
      // phase-label source the title-bar control reads) started at prereqs,
      // and the request names the entry's provider id.
      expect(store.getSnapshot().launch['p1']?.status).toBe('prereqs')
      // Settle the run so the launch abort registry and run markers clear.
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(store.getSnapshot().launch['p1']?.status).toBe('running')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('posts the open draft on the edited provider title-bar Launch, saving nothing', async () => {
    vi.useFakeTimers()
    try {
      // The entry's stored values (flag checked, Auto Rebuild unchecked,
      // engine directory /eng) differ from every draft value the test edits.
      const summary = fullSummary({
        providers: [
          {
            id: 'p1',
            engine: 'ninfer',
            model: 'a-model',
            status: 'stopped',
            config: { flag: true },
            platform: { engineDirectory: '/eng' },
            autoRebuild: false,
          },
        ] as unknown as LocalInferSummary['providers'],
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/logs': () =>
          new Response('{"snapshot":"","seq":0,"running":false}\n', {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
          }),
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, store, rerender } = renderCard({ summary })
      // Open p1 for editing: the form loads the stored values.
      const editBtn = find(tree, (e) => e.type === 'button' && text(e) === t.edit)
      expect(editBtn).toBeDefined()
      ;(editBtn?.props?.onClick as () => void)()
      await flush()
      expect(store.getSnapshot().ui.editingProviderId).toBe('p1')
      // Edit three draft values through the form: the Flag field, the
      // engine-directory platform row, and the Auto Rebuild box.
      const editing = rerender()
      clickBox(fieldCheckbox(editing, 'Flag'), false)
      const engDir = find(
        editing,
        (e) => e.type === 'input' && e.props?.value === '/eng',
      )
      expect(engDir).toBeDefined()
      ;(engDir?.props?.onChange as (ev: { target: { value: string } }) => void)({
        target: { value: '/eng2' },
      })
      clickBox(autoRebuildBox(rerender()), true)
      // Click the title-bar Launch (the primary control).
      const launchBtn = find(
        rerender(),
        (e) =>
          e.type === 'button' &&
          text(e) === t.launch &&
          (e.props?.style as Record<string, unknown> | undefined) === PRIMARY_BUTTON,
      )
      expect(launchBtn).toBeDefined()
      ;(launchBtn?.props?.onClick as () => void)()
      expect(store.getSnapshot().launch['p1']?.status).toBe('prereqs')
      // The posted body carries the DRAFT values through the existing
      // request keys, with the platform as one per-engine entry and the
      // entry's own providerId.
      const launchCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith('/local-infer/launch'),
      )
      expect(launchCall).toBeDefined()
      expect(JSON.parse(String((launchCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        engine: 'ninfer',
        config: { flag: false },
        platform: { engineDirectory: '/eng2' },
        providerId: 'p1',
        autoRebuild: true,
      })
      // The click saves nothing: no /local-infer/save fires, the draft keeps
      // its edits (still dirty), and the summary entry keeps its stored
      // values.
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).startsWith('/local-infer/save')),
      ).toBe(false)
      expect(store.getSnapshot().dirty).toBe(true)
      expect(store.getSnapshot().draft?.config.flag).toBe(false)
      const stored = store.getSnapshot().summary?.providers[0] as
        | { config: Record<string, unknown>; autoRebuild?: boolean; platform?: Record<string, unknown> }
        | undefined
      expect(stored?.config).toEqual({ flag: true })
      expect(stored?.autoRebuild).toBe(false)
      // Settle the run so the machine, abort registry, and run markers clear.
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(store.getSnapshot().launch['p1']?.status).toBe('running')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('launches a collapsed-list row with the stored entry values, not the draft', async () => {
    vi.useFakeTimers()
    try {
      // No provider form is open (no editingProviderId, a new-mode draft with
      // different values): the row's Launch button must post the stored entry.
      const summary = fullSummary({
        providers: [
          {
            id: 'p1',
            engine: 'ninfer',
            model: 'a-model',
            status: 'stopped',
            config: { flag: true },
            platform: { engineDirectory: '/eng' },
          },
        ] as unknown as LocalInferSummary['providers'],
      })
      const stream = launchStream()
      const { fetchMock } = routeFetch({
        '/local-infer/launch': () => stream.response(),
        '/local-infer/logs': () =>
          new Response('{"snapshot":"","seq":0,"running":false}\n', {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
          }),
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, store } = renderCard({ summary, draft: fullDraft() })
      // The row's Launch is the ghost one in the provider list (the title-bar
      // control is a draft-target Launch: no provider is being edited).
      const rowLaunch = find(
        tree,
        (e) =>
          e.type === 'button' &&
          text(e) === t.launch &&
          (e.props?.style as Record<string, unknown> | undefined) !== PRIMARY_BUTTON,
      )
      expect(rowLaunch).toBeDefined()
      ;(rowLaunch?.props?.onClick as () => void)()
      expect(store.getSnapshot().launch['p1']?.status).toBe('prereqs')
      const launchCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith('/local-infer/launch'),
      )
      expect(launchCall).toBeDefined()
      expect(JSON.parse(String((launchCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        engine: 'ninfer',
        config: { flag: true },
        platform: { engineDirectory: '/eng' },
        providerId: 'p1',
        autoRebuild: false,
      })
      stream.enqueue('{"result":{"healthy":true}}')
      stream.close()
      await flush(50)
      expect(store.getSnapshot().launch['p1']?.status).toBe('running')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  // sudoPainted finds the wrapper span the Sudo needed throbber renders
  // inside: the only span carrying the warning-token color.
  function sudoPainted(node: unknown): El | undefined {
    return find(
      node,
      (e) =>
        e.type === 'span' &&
        (e.props?.style as Record<string, unknown> | undefined)?.color === SUDO_STATE_LABEL_COLOR,
    )
  }

  it('paints the title-bar control as the Sudo needed throbber at the sudo machine status', () => {
    const summary = fullSummary({
      providers: [
        {
          id: 'p1',
          engine: 'ninfer',
          model: 'a-model',
          status: 'stopped',
          config: {},
          platform: {},
        },
      ] as unknown as LocalInferSummary['providers'],
    })
    const { store, rerender } = renderCard({
      summary,
      draft: fullDraft(),
      ui: { editingProviderId: 'p1', providerFormMode: 'editing' },
    })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'start' } })
    store.dispatch({ type: 'launch/move', providerId: 'p1', event: { type: 'sudoNeeded' } })
    const tree = rerender()
    // The English copy itself: the control reads "Sudo needed", not Launch.
    expect(text(tree)).toContain('Sudo needed')
    const sudoThrobber = find(
      tree,
      (e) => e.type === 'button' && e.props?.['aria-label'] === t.entrySudo,
    )
    expect(sudoThrobber).toBeDefined()
    expect(sudoThrobber?.props?.disabled).toBe(true)
    expect(sudoPainted(tree)).toBeDefined()
  })

  it('paints the title-bar control as the Sudo needed throbber from the draft sudoPending flag', () => {
    const { store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    store.dispatch({ type: 'ui/patch', patch: { sudoPending: true } })
    const tree = rerender()
    expect(text(tree)).toContain(t.entrySudo)
    const sudoThrobber = find(
      tree,
      (e) => e.type === 'button' && e.props?.['aria-label'] === t.entrySudo,
    )
    expect(sudoThrobber).toBeDefined()
    expect(sudoThrobber?.props?.disabled).toBe(true)
    expect(sudoPainted(tree)).toBeDefined()
    // The flag cleared (the run settled): the control falls back to Launch.
    store.dispatch({ type: 'ui/patch', patch: { sudoPending: false } })
    const settled = rerender()
    expect(sudoPainted(settled)).toBeUndefined()
    expect(find(settled, (e) => e.type === 'button' && text(e) === t.launch)).toBeDefined()
  })

  it('renders the getting throbber with the progress strip while a Get run is in flight', () => {
    const { store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    store.dispatch({
      type: 'ui/patch',
      patch: {
        getProgress: {
          step: 'Downloading a.safetensors',
          percent: 42,
          doneBytes: 4,
          totalBytes: 10,
          etaSeconds: 60,
          unit: 'bytes',
        },
      },
    })
    store.dispatch({ type: 'action/start', key: 'get' })
    const tree = rerender()
    // The getting throbber reads the live readout (the download verb + percent).
    expect(text(tree)).toContain(t.gettingVerb + ' 42%')
    // The strip renders next to the throbber with its fill at the percent.
    const strip = find(tree, (e) => e.type === 'div' && e.props?.role === 'progressbar')
    expect(strip).toBeDefined()
    expect((strip?.props?.children as El).props?.style).toMatchObject({ width: '42%' })
    // The ghost Cancel sits after the strip, wired to the cancel driver.
    const cancelBtn = find(tree, (e) => e.type === 'button' && text(e) === t.cancel)
    expect(cancelBtn).toBeDefined()
    expect(typeof cancelBtn?.props?.onClick).toBe('function')
  })

  it('hides the title-bar Cancel button when no Get run is in flight', () => {
    const { tree } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    expect(find(tree, (e) => e.type === 'button' && text(e) === t.cancel)).toBeUndefined()
  })

  it('the title-bar Cancel button dispatches performGetCancel', () => {
    const { store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    // A tracked run in flight: the cancel aborts it through the registry.
    const controller = new AbortController()
    trackGetAbort(controller)
    store.dispatch({
      type: 'ui/patch',
      patch: {
        getProgress: {
          step: 'Downloading a.safetensors',
          percent: 42,
          doneBytes: 4,
          totalBytes: 10,
          etaSeconds: 60,
          unit: 'bytes',
        },
      },
    })
    store.dispatch({ type: 'action/start', key: 'get' })
    const tree = rerender()
    const cancelBtn = find(tree, (e) => e.type === 'button' && text(e) === t.cancel)
    expect(cancelBtn).toBeDefined()
    ;(cancelBtn?.props?.onClick as () => void)()
    // performGetCancel aborted the tracked run and cleared the readout.
    expect(controller.signal.aborted).toBe(true)
    expect(store.getSnapshot().ui.getProgress).toBeNull()
    clearInFlightRuns()
  })

  it('renders the getting throbber without a strip when no progress state has landed', () => {
    const { store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    store.dispatch({ type: 'action/start', key: 'get' })
    const tree = rerender()
    // The readout falls back to the getting label, and the strip is absent.
    expect(text(tree)).toContain(t.gettingReadout)
    expect(find(tree, (e) => e.type === 'div' && e.props?.role === 'progressbar')).toBeUndefined()
  })

  it('renders the unsure banner with the kill commands', () => {
    const summary = fullSummary({
      unsureBanner: {
        message: 'an engine may be running',
        killCommands: ['pkill ninfer'],
      },
    } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(text(tree)).toContain('an engine may be running')
    // The kill commands read as the textarea's value, not its text content.
    const textarea = find(tree, (e) => e.type === 'textarea')
    expect(textarea?.props?.value).toBe('pkill ninfer')
  })

  it('renders the model download button when the hf CLI is detected', () => {
    const summary = fullSummary({
      modelStatus: {
        present: false,
        hfCli: true,
        downloadCommand: 'hf download a-model',
        url: 'https://hf.co/a-model',
      },
    } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(text(tree)).toContain(t.hfCliDetected)
    expect(text(tree)).toContain('hf download a-model')
    expect(find(tree, (e) => e.type === 'button' && text(e) === t.download)).toBeDefined()
  })

  it('paints the model download cell busy with the downloading label', () => {
    const summary = fullSummary({
      modelStatus: {
        present: false,
        hfCli: true,
        downloadCommand: 'hf download a-model',
        url: 'https://hf.co/a-model',
      },
    } as unknown as LocalInferSummary)
    const { store, rerender } = renderCard({ summary, draft: fullDraft() })
    // The download cell pending (the hf pull in flight): the cell's busy
    // label names that process.
    store.dispatch({ type: 'action/start', key: 'download' })
    const tree = rerender()
    expect(
      find(tree, (e) => e.type === 'button' && e.props?.['aria-label'] === t.downloading),
    ).toBeDefined()
  })

  it('renders the model download link without the hf CLI', () => {
    const summary = fullSummary({
      modelStatus: {
        present: false,
        hfCli: false,
        downloadCommand: 'hf download a-model',
        url: 'https://hf.co/a-model',
      },
    } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(text(tree)).toContain(t.noHfCli)
    expect(find(tree, (e) => e.type === 'a' && e.props?.href === 'https://hf.co/a-model')).toBeDefined()
  })

  it('renders the chat-template status row while a template is missing', () => {
    const summary = fullSummary({
      chatTemplateStatus: {
        repo: 'a-repo',
        present: false,
        hfCli: true,
        downloadCommand: 'hf download a-repo --include chat_template.jinja',
      },
    } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    // The row reads the hf-CLI-detected line with the command and the
    // download button (the auto-download effect fires it first).
    expect(text(tree)).toContain(t.hfCliDetected)
    expect(text(tree)).toContain('hf download a-repo')
    expect(find(tree, (e) => e.type === 'button' && text(e) === t.templateDownload)).toBeDefined()
  })

  it('renders the warning banner and the over verdict', () => {
    const summary = fullSummary({
      warningsModel: {
        banner: {
          visible: true,
          level: 'error',
          count: 2,
          warnings: [
            { id: 'w1', message: 'over budget' },
            { id: 'w2', message: 'tight fit' },
          ],
        },
        inline: {},
      },
      verdict: { status: 'over', detail: 'needs 16GB, has 8GB' },
    } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(text(tree)).toContain(t.over)
    expect(text(tree)).toContain('needs 16GB, has 8GB')
    expect(text(tree)).toContain('over budget')
  })

  it('renders the launch and stop error notes', () => {
    const { store, rerender } = renderCard({ summary: fullSummary(), draft: fullDraft() })
    store.dispatch({ type: 'action/start', key: 'launch' })
    store.dispatch({ type: 'action/timeout', key: 'launch' })
    store.dispatch({ type: 'action/start', key: 'stop' })
    store.dispatch({ type: 'action/fail', key: 'stop', detail: 'no process' })
    const tree = rerender()
    // The launch timeout reads as the launch-failed note; the stop failure
    // reads as the route's own message.
    expect(text(tree)).toContain(t.launchFailed)
    expect(text(tree)).toContain('no process')
  })

  it('renders the unregister button when the model is registered', () => {
    const summary = fullSummary({ registered: true } as unknown as LocalInferSummary)
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(find(tree, (e) => e.type === 'button' && text(e) === t.unregister)).toBeDefined()
  })

  it('renders the no-parameters line when there are no fields', () => {
    const summary = fullSummary({ formModel: { sections: [] } })
    const { tree } = renderCard({ summary, draft: fullDraft() })
    expect(text(tree)).toContain(t.noParameters)
  })

  it('shows the help rows when help is on', () => {
    const { tree } = renderCard({
      summary: fullSummary(),
      draft: fullDraft(),
      ui: { help: true },
    })
    // The engine help row reads the engine description.
    expect(text(tree)).toContain(t.engineHelp)
  })

  it('the debounced re-price fires after a field edit pauses', async () => {
    vi.useFakeTimers()
    try {
      const summary = fullSummary()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, store } = renderCard({ summary, draft: fullDraft() })
      // A field edit schedules the 300 ms re-price.
      const checkbox = fieldCheckbox(tree, 'Flag')
      ;(checkbox.props?.onChange as (ev: { target: { checked: boolean } }) => void)({
        target: { checked: false },
      })
      // Before the debounce window, no re-price fetch has fired.
      expect(calls.filter((c) => c.url.startsWith('/local-infer/summary'))).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(300)
      await flush()
      // The re-price re-fetched the summary and the deps.
      expect(calls.some((c) => c.url.startsWith('/local-infer/summary'))).toBe(true)
      expect(calls.some((c) => c.url.startsWith('/local-infer/deps'))).toBe(true)
      void store
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the mount effect fetches the read model on an empty card', async () => {
    vi.useFakeTimers()
    try {
      const summary = fullSummary()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      // No summary and no draft: the mount effect fetches on the first render.
      const Component = card(null, localeRef('en'), null)
      const { dispatcher, runEffects } = makeDispatcher()
      withDispatcher(dispatcher, () => {
        Component()
      })
      runEffects()
      await flush()
      expect(calls.some((c) => c.url.startsWith('/local-infer/summary'))).toBe(true)
      expect(calls.some((c) => c.url.startsWith('/local-infer/deps'))).toBe(true)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('unmount clears the pending re-price timer', async () => {
    vi.useFakeTimers()
    try {
      const summary = fullSummary()
      const { calls, fetchMock } = routeFetch({
        '/local-infer/summary': () => jsonAnswer(summary),
        '/local-infer/deps': () => jsonAnswer(depsAnswer()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { tree, runCleanups } = renderCard({ summary, draft: fullDraft() })
      // A field edit schedules the re-price, then the card unmounts.
      const checkbox = fieldCheckbox(tree, 'Flag')
      ;(checkbox.props?.onChange as (ev: { target: { checked: boolean } }) => void)({
        target: { checked: false },
      })
      runCleanups()
      await vi.advanceTimersByTimeAsync(300)
      await flush()
      // The timer was cleared on unmount, so no re-price fetch fired.
      expect(calls.filter((c) => c.url.startsWith('/local-infer/summary'))).toHaveLength(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
