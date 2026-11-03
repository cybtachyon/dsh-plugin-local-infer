import * as reactModule from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { injectStyles, SelectPill } from '../src/render/SelectPill.tsx'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'

// A renderer returns a React element (a plain object). The tests drive the
// element tree without a renderer, so no react-dom is needed.
type El = { type: unknown; props: Record<string, unknown> }
const el = (x: unknown): El => x as El

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

// The dispatcher the pill tests drive: it keeps the open flag across renders,
// the way React keeps useState state, so a click re-render reads the fresh
// flag.
function makeOpenDispatcher() {
  let open = false
  const dispatcher = {
    useState: (initial: unknown) => {
      if (open === false && initial !== false) {
        open = initial as boolean
      }
      return [
        open,
        (update: boolean | ((prev: boolean) => boolean)) => {
          open = typeof update === 'function' ? (update as (prev: boolean) => boolean)(open) : update
        },
      ]
    },
    useRef: (initialValue: unknown) => ({ current: initialValue }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return { dispatcher, isOpen: () => open }
}

// MenuStub stands in for the host's Menu component: it renders a marker
// element carrying the props the pill hands it, so a test reads them back.
function MenuStub() {
  return null
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the selector pill (render/SelectPill.tsx)', () => {
  it('hands the pill anchor to the host Menu with the list and selection', () => {
    const { dispatcher } = makeOpenDispatcher()
    const onSelect = vi.fn()
    const rendered = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [
            { id: 'ninfer', label: 'NInfer' },
            { id: 'strata', label: 'Strata' },
          ],
          selectedId: 'ninfer',
          onSelect,
        }),
      ),
    )
    // The element is the host Menu, seeded with the pill anchor and the list.
    expect(rendered.type).toBe(MenuStub)
    expect(rendered.props.open).toBe(false)
    expect(rendered.props.items).toHaveLength(2)
    expect(rendered.props.selectedId).toBe('ninfer')
    expect(rendered.props.align).toBe('end')
    expect(rendered.props.portal).toBe(true)
    const anchor = el(rendered.props.anchor)
    expect(anchor.type).toBe('button')
    expect(anchor.props.className).toBe('dsh-li-selector')
    expect(anchor.props['aria-haspopup']).toBe('menu')
    expect(anchor.props['aria-expanded']).toBe(false)
  })

  it('toggles the open flag on a pill click and re-renders the Menu', () => {
    const { dispatcher, isOpen } = makeOpenDispatcher()
    const first = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
        }),
      ),
    )
    expect(isOpen()).toBe(false)
    // Click the pill anchor: it flips the open flag.
    ;(el(first.props.anchor).props.onClick as () => void)()
    expect(isOpen()).toBe(true)
    // The re-render reads the fresh flag into the Menu's open prop.
    const second = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
        }),
      ),
    )
    expect(second.props.open).toBe(true)
  })

  it('does not toggle while the pill is disabled', () => {
    const { dispatcher, isOpen } = makeOpenDispatcher()
    const first = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
          disabled: true,
        }),
      ),
    )
    const anchor = el(first.props.anchor)
    expect(anchor.props.disabled).toBe(true)
    ;(anchor.props.onClick as () => void)()
    expect(isOpen()).toBe(false)
  })

  it('selecting an item calls onSelect and closes the list', () => {
    const { dispatcher, isOpen } = makeOpenDispatcher()
    const onSelect = vi.fn()
    const first = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect,
        }),
      ),
    )
    // Open, then select through the Menu's onSelect.
    ;(el(first.props.anchor).props.onClick as () => void)()
    expect(isOpen()).toBe(true)
    ;(first.props.onSelect as (id: string) => void)('strata')
    expect(onSelect).toHaveBeenCalledWith('strata')
    expect(isOpen()).toBe(false)
  })

  it('closes the list through the Menu onClose', () => {
    const { dispatcher, isOpen } = makeOpenDispatcher()
    const first = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
        }),
      ),
    )
    ;(el(first.props.anchor).props.onClick as () => void)()
    expect(isOpen()).toBe(true)
    ;(first.props.onClose as () => void)()
    expect(isOpen()).toBe(false)
  })

  it('draws the chevron inside the pill when a chevron component is given', () => {
    const ChevronStub = () => null
    const { dispatcher } = makeOpenDispatcher()
    const rendered = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          Chevron: ChevronStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
        }),
      ),
    )
    const anchor = el(rendered.props.anchor)
    // The anchor's children carry the label and the chevron element.
    const children = anchor.props.children as unknown[]
    expect(children).toHaveLength(2)
    expect(el(children[1]).type).toBe(ChevronStub)
  })

  it('omits the chevron when none is given', () => {
    const { dispatcher } = makeOpenDispatcher()
    const rendered = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
        }),
      ),
    )
    const anchor = el(rendered.props.anchor)
    const children = anchor.props.children as unknown[]
    // Only the label; the chevron slot reads as null and drops out.
    expect(children.filter((x) => x !== null && x !== undefined)).toHaveLength(1)
  })

  it('passes the element id to the pill button when given', () => {
    const { dispatcher } = makeOpenDispatcher()
    const rendered = withDispatcher(dispatcher, () =>
      el(
        SelectPill({
          Menu: MenuStub,
          label: 'Engine',
          items: [{ id: 'ninfer', label: 'NInfer' }],
          selectedId: 'ninfer',
          onSelect: () => {},
          id: 'engine-select',
        }),
      ),
    )
    expect(el(rendered.props.anchor).props.id).toBe('engine-select')
  })
})

describe('the selector pill style injection (render/SelectPill.tsx injectStyles)', () => {
  it('is a no-op on a host without a document', () => {
    // Node has no document global; the guard returns before touching it.
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined')
    expect(() => injectStyles()).not.toThrow()
  })

  it('injects the pill CSS once and skips a second call', () => {
    const created: Array<{ id: string; textContent: string }> = []
    const byId = new Map<string, unknown>()
    const doc = {
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => {
        const style = { id: '', textContent: '', tagName: tag }
        created.push(style)
        return style
      },
      head: {
        appendChild(style: { id: string }) {
          byId.set(style.id, style)
        },
      },
    }
    vi.stubGlobal('document', doc)
    try {
      injectStyles()
      expect(created).toHaveLength(1)
      expect(created[0].id).toBe('dsh-local-infer-styles')
      expect(created[0].textContent).toContain('.dsh-li-selector')
      // A second call finds the existing element and returns.
      injectStyles()
      expect(created).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
