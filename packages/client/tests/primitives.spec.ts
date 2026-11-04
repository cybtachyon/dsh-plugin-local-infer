import * as reactModule from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  getPrimitivesModule,
  renderButton,
  renderCheckbox,
  renderHelpRow,
  renderPill,
  renderProcessButton,
  renderProgressStrip,
  renderSelect,
  renderStateDot,
  renderThrobber,
  setPrimitivesModule,
  type PrimitivesModule,
} from '../src/render/primitives.tsx'
import { react as shim } from '../src/render/react.ts'
import { SelectPill } from '../src/render/SelectPill.tsx'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'
import type { GetProgressState } from '../src/store/progress.ts'
import { GHOST_BUTTON, PRIMARY_BUTTON, PROGRESS_STRIP_TRACK } from '../src/styles.ts'

// A renderer returns a React element (a plain object) or null. The tests
// inspect the element's type and props without a renderer, so no react-dom is
// needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El

// Marker components stand in for the primitives seed's exports. A renamed or
// dropped member the card touches shows up as the wrong marker (or a native
// fallback) in the assertions below.
const MenuMarker = () => null
const ButtonMarker = () => null
const CheckboxMarker = () => null
const StateDotMarker = () => null
const ChevronMarker = () => null
const PillMarker = () => null
const seed: PrimitivesModule = {
  Menu: MenuMarker,
  Button: ButtonMarker,
  Checkbox: CheckboxMarker,
  StateDot: StateDotMarker,
  Pill: PillMarker,
  IconChevronDownOutlineRegular: ChevronMarker,
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

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('client primitive renderers (render/primitives.tsx)', () => {
  it('renderButton draws the seed Button when present', () => {
    setPrimitivesModule(seed)
    const e = el(renderButton('primary', { onClick: () => {} }, 'Save'))
    expect(e.type).toBe(ButtonMarker)
    expect(e.props.variant).toBe('primary')
    expect(e.props.size).toBe('sm')
    expect(e.props.type).toBe('button')
  })

  it('renderButton falls back to a native button when the seed is absent', () => {
    setPrimitivesModule(null)
    const primary = el(renderButton('primary', { onClick: () => {} }, 'Save'))
    expect(primary.type).toBe('button')
    expect(primary.props.style).toBe(PRIMARY_BUTTON)
    const ghost = el(renderButton('ghost', {}, 'Discard'))
    expect(ghost.type).toBe('button')
    expect(ghost.props.style).toBe(GHOST_BUTTON)
  })

  it('renderPill draws the seed Pill when present', () => {
    setPrimitivesModule(seed)
    const onClick = () => {}
    const e = el(renderPill('Cancel', { onClick }))
    expect(e.type).toBe(PillMarker)
    expect(e.props.onClick).toBe(onClick)
    expect(e.props.children).toBe('Cancel')
  })

  it('renderPill falls back to a native pill button when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(renderPill('Cancel', { onClick: () => {} }))
    expect(e.type).toBe('button')
    expect(e.props.type).toBe('button')
    expect(e.props.children).toBe('Cancel')
    const style = e.props.style as Record<string, unknown>
    expect(style.borderRadius).toBe(10)
  })

  it('renderCheckbox draws the seed Checkbox when present', () => {
    setPrimitivesModule(seed)
    const e = el(renderCheckbox({ checked: true, label: 'Auto', onChange: () => {} }))
    expect(e.type).toBe(CheckboxMarker)
    expect(e.props.checked).toBe(true)
    expect(e.props.label).toBe('Auto')
  })

  it('renderCheckbox falls back to a native label when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(renderCheckbox({ checked: false, label: 'Auto', onChange: () => {} }))
    expect(e.type).toBe('label')
  })

  it('the native checkbox fallback reports the checked state through onChange', () => {
    setPrimitivesModule(null)
    const onChange = vi.fn()
    const e = el(renderCheckbox({ checked: false, label: 'Auto', onChange }))
    // The input is the label's first child.
    const input = (e.props.children as unknown[]).find(
      (x) => typeof x === 'object' && x !== null && (x as El).type === 'input',
    ) as El
    ;(input.props.onChange as (ev: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renderStateDot draws the seed StateDot when present', () => {
    setPrimitivesModule(seed)
    const e = el(renderStateDot('done'))
    expect(e.type).toBe(StateDotMarker)
    expect(e.props.state).toBe('done')
  })

  it('renderStateDot falls back to a glyph span when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(renderStateDot('done'))
    expect(e.type).toBe('span')
  })

  it('renderThrobber draws the seed ongoing StateDot when present', () => {
    setPrimitivesModule(seed)
    const e = el(renderThrobber())
    expect(e.type).toBe(StateDotMarker)
    expect(e.props.state).toBe('ongoing')
    expect(e.props.size).toBe(12)
  })

  it('renderThrobber falls back to a CSS spin span when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(renderThrobber())
    expect(e.type).toBe('span')
  })

  it('renderProcessButton shows a disabled throbber control while busy', () => {
    setPrimitivesModule(null)
    const e = el(
      renderProcessButton({ busy: true, label: 'Get', busyLabel: 'getting', variant: 'ghost' }),
    )
    expect(e.type).toBe('button')
    expect(e.props.disabled).toBe(true)
    expect(e.props['aria-label']).toBe('getting')
    expect(Array.isArray(e.props.children)).toBe(true)
    expect((e.props.children as unknown[]).length).toBe(2)
  })

  it('renderProcessButton resets to the idle action button when not busy', () => {
    setPrimitivesModule(null)
    const e = el(
      renderProcessButton({ label: 'Get', busyLabel: 'getting', variant: 'ghost', onClick: () => {} }),
    )
    expect(e.type).toBe('button')
    expect(e.props.disabled).toBe(false)
    expect(e.props.children).toBe('Get')
  })

  it('renderHelpRow renders nothing for an empty text', () => {
    expect(renderHelpRow('')).toBe(null)
    expect(renderHelpRow(null)).toBe(null)
    expect(renderHelpRow(undefined)).toBe(null)
  })

  it('renderHelpRow renders a description div for a text', () => {
    const e = el(renderHelpRow('The engine directory'))
    expect(e.type).toBe('div')
    expect(e.props.children).toBe('The engine directory')
  })

  it('renderSelect draws the Menu pill when the seed is present', () => {
    setPrimitivesModule(seed)
    const e = el(
      renderSelect({
        label: 'Engine',
        items: [{ id: 'ninfer', label: 'NInfer' }],
        value: 'ninfer',
        onSelect: () => {},
        id: 'engine-select',
      }),
    )
    expect(e.type).toBe(SelectPill)
    expect(e.props.Menu).toBe(MenuMarker)
    expect(e.props.selectedId).toBe('ninfer')
    // The id flows to the pill button, so the row's label can associate.
    expect(e.props.id).toBe('engine-select')
  })

  it('renderSelect falls back to a native select when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(
      renderSelect({
        label: 'Engine',
        items: [
          { id: 'ninfer', label: 'NInfer' },
          { id: 'strata', label: 'Strata' },
        ],
        value: 'ninfer',
        onSelect: () => {},
        id: 'engine-select',
      }),
    )
    expect(e.type).toBe('select')
    expect(e.props.value).toBe('ninfer')
    expect(e.props.id).toBe('engine-select')
    expect(Array.isArray(e.props.children)).toBe(true)
    expect((e.props.children as unknown[]).length).toBe(2)
  })

  it('renderSelect omits the id attribute when no id is given', () => {
    setPrimitivesModule(null)
    const e = el(
      renderSelect({
        label: 'Engine',
        items: [{ id: 'ninfer', label: 'NInfer' }],
        value: 'ninfer',
        onSelect: () => {},
      }),
    )
    expect(e.type).toBe('select')
    expect('id' in e.props).toBe(false)
  })

  it('getPrimitivesModule reflects setPrimitivesModule', () => {
    setPrimitivesModule(seed)
    expect(getPrimitivesModule()).toBe(seed)
    setPrimitivesModule(null)
    expect(getPrimitivesModule()).toBe(null)
  })
})

describe('the progress strip renderer (renderProgressStrip)', () => {
  const progress: GetProgressState = {
    step: 'Downloading a.safetensors',
    percent: 42,
    doneBytes: 4,
    totalBytes: 10,
    etaSeconds: 60,
    unit: 'bytes',
  }

  it('renders nothing when the progress state is null or undefined', () => {
    setPrimitivesModule(null)
    expect(renderProgressStrip(null)).toBe(null)
    expect(renderProgressStrip(undefined)).toBe(null)
  })

  it('degrades to a native track div when the seed is absent', () => {
    setPrimitivesModule(null)
    const e = el(renderProgressStrip(progress))
    expect(e.type).toBe('div')
    expect(e.props.style).toBe(PROGRESS_STRIP_TRACK)
    expect(e.props.role).toBe('progressbar')
  })

  it('draws a fill whose width style tracks the percent', () => {
    setPrimitivesModule(null)
    const e = el(renderProgressStrip(progress))
    const fill = e.props.children as El
    expect(fill.type).toBe('div')
    expect(fill.props.style).toEqual({
      height: '100%',
      width: '42%',
      background: 'var(--dsw-alias-accent, #0a84ff)',
    })
  })

  it('clamps the fill width to the 0-100 range', () => {
    setPrimitivesModule(null)
    const over = el(renderProgressStrip({ ...progress, percent: 150 }))
    expect((over.props.children as El).props.style).toMatchObject({ width: '100%' })
    const under = el(renderProgressStrip({ ...progress, percent: -5 }))
    expect((under.props.children as El).props.style).toMatchObject({ width: '0%' })
  })

  it('draws the seed Progress when the host provides one', () => {
    const ProgressMarker = () => null
    setPrimitivesModule({ Progress: ProgressMarker })
    const e = el(renderProgressStrip(progress))
    expect(e.type).toBe(ProgressMarker)
    expect(e.props.value).toBe(42)
    setPrimitivesModule(null)
  })
})

describe('the module-scope react shim (render/react.ts)', () => {
  it('delegates createElement and Fragment to the wired module', () => {
    expect(el(shim.createElement('div', null)).type).toBe('div')
    expect(shim.Fragment).toBe(reactModule.Fragment)
  })

  it('delegates the hooks to the wired module under a dispatcher', () => {
    const dispatcher = {
      useState: (initial: unknown) => [initial, () => {}],
      useRef: (initial: unknown) => ({ current: initial }),
      useEffect: () => {},
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    }
    withDispatcher(dispatcher, () => {
      expect(shim.useState(1)[0]).toBe(1)
      expect(shim.useRef(2).current).toBe(2)
      shim.useEffect(() => {})
      expect(shim.useSyncExternalStore(() => () => {}, () => 'snap')).toBe('snap')
    })
  })
})
