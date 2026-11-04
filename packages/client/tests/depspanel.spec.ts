import * as reactModule from 'react'
import type { DepsModel } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DepsPanel } from '../src/render/DepsPanel.tsx'
import { cardReducer } from '../src/store/reducer.ts'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardState } from '../src/store/types.ts'
import { TEXT } from '../src/text.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El
// children flattens the element's children (a single child, an array, or an
// array carrying a nested JSX map array), dropping the null entries a JSX
// conditional branch ({cond ? el : null}) emits into the array.
function children(e: El): El[] {
  const c = e.props.children
  if (c === undefined || c === null) {
    return []
  }
  const list = Array.isArray(c) ? c : [c]
  return list
    .flatMap((x): unknown => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]))
    .filter((x): x is unknown => x !== null && x !== undefined)
    .map(el)
}
// text reads the element tree's text content.
function text(e: El): string {
  const c = e.props.children
  if (c === undefined || c === null) {
    return ''
  }
  const list = Array.isArray(c) ? c : [c]
  return list
    .map((x) => (typeof x === 'object' && x !== null ? text(el(x)) : String(x ?? '')))
    .join('')
}
// buttons collects every button element in the tree, so a control row reads
// as its buttons in render order. Text nodes (a button's label) read as no
// buttons.
function buttons(node: unknown): El[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return []
  }
  const e = node as El
  const own = e.type === 'button' ? [e] : []
  return [...own, ...children(e).flatMap(buttons)]
}

// makeStore builds a test store over the real reducer, the way the card's
// per-mount store does.
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

// depsWith builds the panel model the tests draw.
function depsWith(patch: Partial<DepsModel> = {}): DepsModel {
  return {
    engineId: 'ninfer',
    buildMode: 'docker',
    packageManager: 'apt',
    deps: [
      { id: 'git', purpose: 'source sync', status: 'satisfied', requiresSudo: false },
      { id: 'cuda', purpose: 'toolkit', status: 'missing', requiresSudo: true },
    ],
    allSatisfied: false,
    installString: 'apt install -y cuda-toolkit',
    runAllowed: true,
    ...patch,
  }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the System dependencies panel (render/DepsPanel.tsx)', () => {
  const t = TEXT.en

  it('renders nothing for a null model', () => {
    const { store } = makeStore()
    expect(DepsPanel({ store, t })).toBe(null)
  })

  it('renders the title, the dep rows, the install block, and the control row', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith() })
    const root = el(DepsPanel({ store, t }))
    expect(root.type).toBe('div')
    const [titleRow, rows, installBlock, controlRow] = children(root)
    expect(text(titleRow)).toContain(t.depsTitle)
    // The dep rows read their status from a dot, the id, and the purpose
    // with the sudo hint (a non-winget package manager keeps it).
    const [gitRow, cudaRow] = children(rows)
    expect(text(gitRow)).toContain('git')
    expect(text(gitRow)).toContain('source sync')
    expect(text(cudaRow)).toContain('cuda')
    expect(text(cudaRow)).toContain('toolkit (sudo)')
    // The install block carries the string and the copy button.
    expect(text(installBlock)).toContain('apt install -y cuda-toolkit')
    expect(buttons(installBlock)).toHaveLength(1)
    expect(text(buttons(installBlock)[0])).toBe(t.copy)
    // The control row carries the allow-run checkbox, the Run arrow (the
    // trust gate is on and a dep is unsatisfied), and the disabled Get gate.
    const controls = children(controlRow)
    expect(controls).toHaveLength(3)
    expect(text(controls[0])).toContain(t.allowRun)
    expect(text(controls[1])).toBe('▶ ' + t.run)
    expect(el(controls[2]).props.disabled).toBe(true)
    expect(text(controls[2])).toBe(t.get)
  })

  it('shows the package-manager-unknown hint and the no-deps line', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'deps/ack',
      deps: depsWith({ packageManager: null, deps: [], installString: '' }),
    })
    const root = el(DepsPanel({ store, t }))
    const [titleRow, noDeps] = children(root)
    expect(text(titleRow)).toContain(t.pmUnknown)
    expect(text(noDeps)).toBe(t.depsNone)
  })

  it('renders the chat-template row while a template is missing', () => {
    const { store } = makeStore()
    store.dispatch({
      type: 'deps/ack',
      deps: depsWith({
        chatTemplate: {
          repo: 'a-repo',
          present: false,
          hfCli: false,
          downloadCommand: 'hf download a-repo --include chat_template.jinja',
        },
      }),
    })
    const root = el(DepsPanel({ store, t }))
    expect(text(root)).toContain(t.templateAbsent)
    expect(text(root)).toContain(t.templateInstructions)
    expect(text(root)).toContain('hf download a-repo')
  })

  it('hides the Run arrow while the trust gate is off', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith({ runAllowed: false }) })
    const root = el(DepsPanel({ store, t }))
    const controlRow = children(root)[3]
    // Only the checkbox and the Get gate remain.
    expect(children(controlRow)).toHaveLength(2)
  })

  it('enables the Get gate when every dep is satisfied', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith({ allSatisfied: true }) })
    const root = el(DepsPanel({ store, t }))
    const controlRow = children(root)[3]
    const get = children(controlRow)[1]
    expect(el(get).props.disabled).toBe(false)
    // Every dep satisfied: the Run arrow has nothing left to install.
    expect(children(controlRow)).toHaveLength(2)
  })

  it('reads the copy note over the copy label while it is set', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith() })
    store.dispatch({ type: 'note/set', key: 'copy', note: t.copied })
    const root = el(DepsPanel({ store, t }))
    const installBlock = children(root)[2]
    expect(text(buttons(installBlock)[0])).toBe(t.copied)
  })

  it('renders the install result note and the install error detail', () => {
    const { store, state } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith() })
    store.dispatch({ type: 'note/set', key: 'deps', note: t.depsSatisfied })
    let root = el(DepsPanel({ store, t }))
    expect(text(root)).toContain(t.depsSatisfied)
    // A failed install cell reads as the route's own message.
    store.dispatch({ type: 'action/start', key: 'install' })
    store.dispatch({ type: 'action/fail', key: 'install', detail: t.installRejected })
    expect(state().actions.install).toEqual({ status: 'error', detail: t.installRejected })
    root = el(DepsPanel({ store, t }))
    expect(text(root)).toContain(t.installRejected)
  })

  it('renders the busy labels while the install and get cells are pending', () => {
    const { store } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith() })
    store.dispatch({ type: 'action/start', key: 'install' })
    store.dispatch({ type: 'action/start', key: 'get' })
    const root = el(DepsPanel({ store, t }))
    const controlRow = children(root)[3]
    // The first control is the allow-run checkbox; the Run and Get buttons
    // follow it.
    const [, run, get] = children(controlRow)
    expect(text(run)).toBe(t.running)
    expect(el(run).props.disabled).toBe(true)
    expect(text(get)).toBe(t.getting)
    expect(el(get).props.disabled).toBe(true)
  })
})

// The panel's control handlers: the copy button, the allow-run checkbox, and
// the Run and Get process buttons ride the store drivers. These tests invoke
// the rendered handlers and read the store cells they settle.
describe('the deps panel control handlers (render/DepsPanel.tsx)', () => {
  const t = TEXT.en

  // routeFetch stubs the global fetch with a per-route answer table.
  function routeFetch(routes: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      const path = url.split('?')[0]
      const factory = routes[path]
      if (factory === undefined) {
        return new Response(JSON.stringify({ error: 'no such route' }), { status: 404 })
      }
      return factory()
    })
    return fetchMock
  }

  function jsonAnswer(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  // getStream builds a /local-infer/get answer whose body streams NDJSON log
  // events.
  function getStream() {
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
      enqueue: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
      close: () => controller.close(),
    }
  }

  async function flush(times = 30): Promise<void> {
    for (let i = 0; i < times; i++) {
      await Promise.resolve()
    }
  }

  // seedDepsAndDraft builds a store with the deps model and a draft (the
  // allow-run, install, and Get drivers read the draft's engine and config).
  function seedDepsAndDraft(patch: Partial<DepsModel> = {}) {
    const { store, state } = makeStore()
    store.dispatch({ type: 'deps/ack', deps: depsWith(patch) })
    store.dispatch({
      type: 'draft/load',
      draft: { engine: 'ninfer', config: { model: 'a-model' }, platform: {} },
    })
    return { store, state }
  }

  it('the copy button hands the install string to the clipboard and sets the note', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = seedDepsAndDraft()
      const writeText = vi.fn(() => Promise.resolve())
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const root = el(DepsPanel({ store, t }))
      // The copy button is the install block's only button.
      const installBlock = children(root)[2]
      const copyButton = buttons(installBlock)[0]
      ;(copyButton.props.onClick as () => void)()
      expect(writeText).toHaveBeenCalledWith('apt install -y cuda-toolkit')
      // The clipboard write is async; let it settle before reading the note.
      await flush()
      // The copied note lands over the copy label.
      expect(state().notes.copy).toBe(t.copied)
      // The note clears after two seconds.
      await vi.advanceTimersByTimeAsync(2000)
      expect(state().notes.copy).toBe('')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the copy button reads as a failure on a host without a clipboard', () => {
    const { store, state } = seedDepsAndDraft()
    // A navigator without a clipboard (a host that predates the API) reads as
    // a copy failure.
    vi.stubGlobal('navigator', {})
    try {
      const root = el(DepsPanel({ store, t }))
      const installBlock = children(root)[2]
      const copyButton = buttons(installBlock)[0]
      ;(copyButton.props.onClick as () => void)()
      expect(state().notes.copy).toBe(t.copyFailed)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the allow-run checkbox persists the trust gate through a settings save', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = seedDepsAndDraft()
      const fetchMock = routeFetch({
        '/local-infer/save': () => jsonAnswer({ engineId: 'ninfer' }),
        '/local-infer/deps': () => jsonAnswer(depsWith()),
      })
      vi.stubGlobal('fetch', fetchMock)
      const root = el(DepsPanel({ store, t }))
      const controlRow = children(root)[3]
      // The allow-run checkbox is the control row's first control: a native
      // label wrapping the input, so the input is the label's first child.
      const label = children(controlRow)[0]
      const checkbox = children(label)[0]
      ;(checkbox.props.onChange as (ev: { target: { checked: boolean } }) => void)({
        target: { checked: false },
      })
      vi.advanceTimersByTime(0)
      await flush()
      expect(state().actions.save.status).toBe('ok')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the Run button runs the install route and lands the re-checked deps', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = seedDepsAndDraft()
      const fetchMock = routeFetch({
        '/local-infer/install': () =>
          jsonAnswer({
            deps: depsWith({ allSatisfied: true }),
            result: { ok: true },
          }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const root = el(DepsPanel({ store, t }))
      const controlRow = children(root)[3]
      // The Run button is the control row's second control (after the checkbox).
      const runButton = children(controlRow)[1]
      ;(runButton.props.onClick as () => void)()
      vi.advanceTimersByTime(0)
      await flush()
      expect(state().actions.install.status).toBe('ok')
      // The re-checked deps model landed (all satisfied).
      expect(state().deps?.allSatisfied).toBe(true)
      expect(state().notes.deps).toBe(t.depsSatisfied)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('the Get button streams the build and appends to the Logs buffer', async () => {
    vi.useFakeTimers()
    try {
      const { store, state } = seedDepsAndDraft()
      const stream = getStream()
      const fetchMock = routeFetch({
        '/local-infer/get': () => stream.response(),
        '/local-infer/summary': () => jsonAnswer({ engineId: 'ninfer' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const root = el(DepsPanel({ store, t }))
      const controlRow = children(root)[3]
      // The Get button is the control row's last control.
      const getButton = children(controlRow)[2]
      ;(getButton.props.onClick as () => void)()
      vi.advanceTimersByTime(0)
      stream.enqueue('{"log":"building...\\n"}\n')
      await flush()
      expect(state().ui.logs.getLogs).toContain('building...')
      stream.close()
      await flush(50)
      expect(state().actions.get.status).toBe('ok')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
