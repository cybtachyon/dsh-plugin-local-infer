import * as reactModule from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CustomArgsPanel,
  nextCustomArgs,
  normalizeCustomArgs,
} from '../src/render/CustomArgsPanel.tsx'
import type { CardStore } from '../src/store/sync.ts'
import { initialCardState, type CardAction, type CardState } from '../src/store/types.ts'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
import { TEXT } from '../src/text.ts'

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

// The stub store the panel tests drive: it captures every dispatched action
// and serves the seeded state, so a test asserts the exact draft/edit the
// row edit produces.
function makeStore(state: CardState) {
  const dispatched: CardAction[] = []
  const store: CardStore = {
    dispatch: (action: CardAction) => {
      dispatched.push(action)
    },
    getSnapshot: () => state,
  }
  return { store, dispatched }
}

// A card state with a draft whose config carries the given customArgs field.
function stateWith(customArgs: unknown, help: boolean = true): CardState {
  const state = initialCardState()
  state.draft = { engine: 'ninfer', config: { customArgs: customArgs }, platform: {} }
  state.ui.help = help
  return state
}

// The panel element tree: the root carries the section title, the optional
// help row, and the grid; the grid carries the three header cells and one
// row div per row; a row div carries the key input, the value input, and the
// + / - button div.
function renderPanel(state: CardState) {
  const { store, dispatched } = makeStore(state)
  const root = el(CustomArgsPanel({ store, t: TEXT.en }))
  const grid = children(root)[children(root).length - 1]
  const headers = children(grid).slice(0, 3)
  const rows = children(grid).slice(3)
  return { root, grid, headers, rows, dispatched }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the custom-args row logic (render/CustomArgsPanel.tsx)', () => {
  it('normalizes an absent, non-array, or empty field to a single blank row', () => {
    expect(normalizeCustomArgs(undefined)).toEqual([{ key: '', value: '' }])
    expect(normalizeCustomArgs(null)).toEqual([{ key: '', value: '' }])
    expect(normalizeCustomArgs('not an array')).toEqual([{ key: '', value: '' }])
    expect(normalizeCustomArgs([])).toEqual([{ key: '', value: '' }])
  })

  it('normalizes malformed entries to blank key/value pairs', () => {
    expect(normalizeCustomArgs([null, 42, { key: '--threads' }, { value: '8' }, 'x'])).toEqual([
      { key: '', value: '' },
      { key: '', value: '' },
      { key: '--threads', value: '' },
      { key: '', value: '8' },
      { key: '', value: '' },
    ])
  })

  it('keeps well-formed rows untouched', () => {
    const rows = [{ key: '--kv-dtype', value: 'int8' }, { key: '--ctx-size', value: '8192' }]
    expect(normalizeCustomArgs(rows)).toEqual(rows)
  })

  it('edits a row key and value in place', () => {
    const rows = [{ key: '--kv-dtype', value: 'int8' }]
    expect(nextCustomArgs(rows, 'key', 0, 'q8_0')).toEqual([{ key: 'q8_0', value: 'int8' }])
    expect(nextCustomArgs(rows, 'value', 0, 'int4')).toEqual([{ key: '--kv-dtype', value: 'int4' }])
  })

  it('appends a blank row on add', () => {
    const rows = [{ key: '--kv-dtype', value: 'int8' }]
    expect(nextCustomArgs(rows, 'add', 0)).toEqual([
      { key: '--kv-dtype', value: 'int8' },
      { key: '', value: '' },
    ])
  })

  it('blanks the first row on clear and keeps the lower rows', () => {
    const rows = [{ key: '--kv-dtype', value: 'int8' }, { key: '--ctx-size', value: '8192' }]
    expect(nextCustomArgs(rows, 'clear', 0)).toEqual([
      { key: '', value: '' },
      { key: '--ctx-size', value: '8192' },
    ])
  })

  it('removes a lower row and keeps the at-least-one-row invariant', () => {
    const rows = [{ key: '--kv-dtype', value: 'int8' }, { key: '--ctx-size', value: '8192' }]
    expect(nextCustomArgs(rows, 'remove', 1)).toEqual([{ key: '--kv-dtype', value: 'int8' }])
    expect(nextCustomArgs(rows, 'remove', 0)).toEqual([{ key: '--ctx-size', value: '8192' }])
    expect(nextCustomArgs([{ key: 'a', value: 'b' }], 'remove', 0)).toEqual([
      { key: '', value: '' },
    ])
  })
})

describe('the Custom Arguments panel (render/CustomArgsPanel.tsx)', () => {
  const t = TEXT.en

  it('renders the header row and one row per custom-args entry', () => {
    const { root, headers, rows } = renderPanel(
      stateWith([{ key: '--kv-dtype', value: 'int8' }]),
    )
    expect(children(root)).toHaveLength(3) // title, help, grid
    expect(headers[0].props.children).toBe(t.customArgKeyHeader)
    expect(headers[1].props.children).toBe(t.customArgValueHeader)
    expect(headers[2].props.children).toBe(t.customArgAddRemoveHeader)
    expect(rows).toHaveLength(1)
    const [keyInput, valueInput, buttons] = children(rows[0])
    expect(keyInput.props.value).toBe('--kv-dtype')
    expect(valueInput.props.value).toBe('int8')
    expect(children(buttons)).toHaveLength(2)
  })

  it('renders a single blank row for an absent field', () => {
    const { rows, grid } = renderPanel(stateWith(undefined))
    expect(rows).toHaveLength(1)
    const [keyInput, valueInput] = children(rows[0])
    expect(keyInput.props.value).toBe('')
    expect(valueInput.props.value).toBe('')
    expect(grid).toBeDefined()
  })

  it('omits the help row while the help toggle is off', () => {
    const { root } = renderPanel(stateWith(undefined, false))
    expect(children(root)).toHaveLength(2) // title, grid
  })

  it('dispatches a draft/edit with the next rows on a key edit', () => {
    const { rows, dispatched } = renderPanel(stateWith([{ key: '--kv-dtype', value: 'int8' }]))
    const [keyInput] = children(rows[0])
    ;(keyInput.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'q8_0' },
    })
    expect(dispatched).toHaveLength(1)
    const action = dispatched[0]
    expect(action.type).toBe('draft/edit')
    if (action.type !== 'draft/edit') {
      return
    }
    expect(action.draft.engine).toBe('ninfer')
    expect(action.draft.config.customArgs).toEqual([{ key: 'q8_0', value: 'int8' }])
    expect(action.draft.platform).toEqual({})
  })

  it('dispatches the clear action for the first row and remove for lower rows', () => {
    const two = stateWith([
      { key: '--kv-dtype', value: 'int8' },
      { key: '--ctx-size', value: '8192' },
    ])
    const { rows, dispatched } = renderPanel(two)
    const buttonsOf = (row: El): El[] => children(children(row)[2])
    const [firstMinus] = [buttonsOf(rows[0])[1]]
    const [secondMinus] = [buttonsOf(rows[1])[1]]
    expect(firstMinus.props['aria-label']).toBe(t.customArgClear)
    expect(secondMinus.props['aria-label']).toBe(t.customArgRemove)
    ;(firstMinus.props.onClick as () => void)()
    expect(dispatched[0]).toMatchObject({
      type: 'draft/edit',
      draft: { config: { customArgs: [{ key: '', value: '' }, { key: '--ctx-size', value: '8192' }] } },
    })
    ;(secondMinus.props.onClick as () => void)()
    expect(dispatched[1]).toMatchObject({
      type: 'draft/edit',
      draft: { config: { customArgs: [{ key: '--kv-dtype', value: 'int8' }] } },
    })
  })

  it('appends a blank row on the plus button', () => {
    const { rows, dispatched } = renderPanel(stateWith([{ key: 'a', value: 'b' }]))
    const [plus] = [children(children(rows[0])[2])[0]]
    ;(plus.props.onClick as () => void)()
    expect(dispatched[0]).toMatchObject({
      type: 'draft/edit',
      draft: { config: { customArgs: [{ key: 'a', value: 'b' }, { key: '', value: '' }] } },
    })
  })

  it('edits the value input through the value action', () => {
    const { rows, dispatched } = renderPanel(stateWith([{ key: '--kv-dtype', value: 'int8' }]))
    const [, valueInput] = children(rows[0])
    ;(valueInput.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'int4' },
    })
    expect(dispatched[0]).toMatchObject({
      type: 'draft/edit',
      draft: { config: { customArgs: [{ key: '--kv-dtype', value: 'int4' }] } },
    })
  })

  it('skips the dispatch when the draft is null', () => {
    const { rows, dispatched } = renderPanel({ ...initialCardState(), draft: null })
    const [keyInput] = children(rows[0])
    ;(keyInput.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'x' },
    })
    expect(dispatched).toHaveLength(0)
  })
})
