import * as reactModule from 'react'
import type { DepsModel } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it } from 'vitest'
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
