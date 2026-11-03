import * as reactModule from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { NumberField, type NumberFieldControl, type NumberFieldField } from '../src/render/NumberField.tsx'
import { setReactModule, type ReactLike } from '../src/store/useCardStore.ts'

// A renderer returns a React element (a plain object). The tests drive the
// element's event handlers without a renderer, so no react-dom is needed.
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

// The hook state a NumberField render drives: the text state (useState) and
// the last-numeric ref (useRef). The stub mirrors React's semantics: the text
// state keeps its value across renders, and the ref object is created once
// with the first render's initial value.
function makeDispatcher() {
  let text: string | undefined
  let ref: { current: number | null } | null = null
  const dispatcher = {
    useState: (initial: unknown) => {
      if (text === undefined) {
        text = initial as string
      }
      return [
        text,
        (update: string | ((prev: string) => string)) => {
          text =
            typeof update === 'function' ? (update as (prev: string) => string)(text as string) : update
        },
      ]
    },
    useRef: (initialValue: unknown) => {
      if (ref === null) {
        ref = { current: initialValue as number | null }
      }
      return ref
    },
    useEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  }
  return {
    dispatcher,
    getText: () => text as string,
  }
}

// The onValue spy: every commit a render pushes into the draft.
function spyOnValue() {
  const calls: Array<[string, number | undefined]> = []
  return {
    calls,
    onValue: (key: string, value: number | undefined) => {
      calls.push([key, value])
    },
  }
}

function render(
  dispatcher: unknown,
  field: NumberFieldField,
  control: NumberFieldControl,
  onValue: (key: string, value: number | undefined) => void,
): El {
  return withDispatcher(dispatcher, () =>
    el(NumberField({ field, control, onValue })),
  )
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the number input (render/NumberField.tsx)', () => {
  it('renders a number input with the field value as text and the control bounds', () => {
    const { dispatcher } = makeDispatcher()
    const e = render(
      dispatcher,
      { key: 'context', value: 8192 },
      { min: 0, max: 131072, step: 1024 },
      () => {},
    )
    expect(e.type).toBe('input')
    expect(e.props.type).toBe('number')
    expect(e.props.value).toBe('8192')
    expect(e.props.min).toBe(0)
    expect(e.props.max).toBe(131072)
    expect(e.props.step).toBe(1024)
    expect(e.props.disabled).toBe(undefined)
  })

  it('passes the disabled flag through and dims the input', () => {
    const { dispatcher } = makeDispatcher()
    const e = render(dispatcher, { key: 'port', value: 8080, disabled: true }, {}, () => {})
    expect(e.props.disabled).toBe(true)
    expect((e.props.style as Record<string, unknown>).opacity).toBe(0.5)
  })

  it('applies the id so the row label can associate through htmlFor', () => {
    const { dispatcher } = makeDispatcher()
    const e = withDispatcher(dispatcher, () =>
      el(NumberField({ field: { key: 'port', value: 8080 }, control: {}, onValue: () => {}, id: 'dsh-li-port' })),
    )
    expect(e.props.id).toBe('dsh-li-port')
  })

  it('omits the id attribute when no id is given', () => {
    const { dispatcher } = makeDispatcher()
    const e = render(dispatcher, { key: 'port', value: 8080 }, {}, () => {})
    expect('id' in e.props).toBe(false)
  })

  it('commits an in-range typed value snapped to the step', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 0 }, { min: 0, step: 0.05 }, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '0.9000000000000001' },
    })
    expect(spy.calls).toEqual([['kv', 0.9]])
  })

  it('holds an out-of-range typed value without committing', () => {
    const { dispatcher, getText } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 1 }, { min: 1, max: 8 }, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '0.5' },
    })
    expect(spy.calls).toEqual([])
    expect(getText()).toBe('0.5')
  })

  it('holds a partial like "1e" without committing', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 1 }, {}, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '1e' },
    })
    expect(spy.calls).toEqual([])
  })

  it('commits undefined when the field is cleared', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 4 }, {}, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '' },
    })
    expect(spy.calls).toEqual([['kv', undefined]])
  })

  // The handlers a render returns close over that render's text. A setText
  // re-renders the component, so the tests re-render between interactions to
  // drive the fresh closures, the way React attaches the latest element's
  // handlers.
  it('clamps an out-of-range text to the bounds on blur', () => {
    const { dispatcher, getText } = makeDispatcher()
    const spy = spyOnValue()
    const field = { key: 'kv', value: 5 }
    const control = { max: 100 }
    const first = render(dispatcher, field, control, spy.onValue)
    ;(first.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '999' },
    })
    expect(spy.calls).toEqual([])
    const second = render(dispatcher, field, control, spy.onValue)
    ;(second.props.onBlur as () => void)()
    expect(spy.calls).toEqual([['kv', 100]])
    expect(getText()).toBe('100')
  })

  it('resets a non-numeric text to the last value on blur without committing', () => {
    const { dispatcher, getText } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 5 }, {}, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: 'abc' },
    })
    ;(e.props.onBlur as () => void)()
    expect(spy.calls).toEqual([])
    expect(getText()).toBe('5')
  })

  it('does not commit a blur when the text is empty', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const e = render(dispatcher, { key: 'kv', value: 5 }, {}, spy.onValue)
    ;(e.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '' },
    })
    ;(e.props.onBlur as () => void)()
    expect(spy.calls).toEqual([['kv', undefined]])
  })

  it('commits on Enter and ignores other keys', () => {
    const { dispatcher } = makeDispatcher()
    const spy = spyOnValue()
    const field = { key: 'kv', value: 5 }
    const control = { max: 100 }
    const first = render(dispatcher, field, control, spy.onValue)
    ;(first.props.onChange as (ev: { target: { value: string } }) => void)({
      target: { value: '999' },
    })
    const second = render(dispatcher, field, control, spy.onValue)
    ;(second.props.onKeyDown as (ev: { key: string }) => void)({ key: 'a' })
    expect(spy.calls).toEqual([])
    ;(second.props.onKeyDown as (ev: { key: string }) => void)({ key: 'Enter' })
    expect(spy.calls).toEqual([['kv', 100]])
  })

  it('resyncs the text when a value lands from outside', () => {
    const { dispatcher, getText } = makeDispatcher()
    render(dispatcher, { key: 'kv', value: 5 }, {}, () => {})
    expect(getText()).toBe('5')
    // The external value (a save, a discard, an engine switch) triggers the
    // adjust-state-during-render resync; the next render reads the new text.
    render(dispatcher, { key: 'kv', value: 10 }, {}, () => {})
    expect(getText()).toBe('10')
    const e = render(dispatcher, { key: 'kv', value: 10 }, {}, () => {})
    expect(e.props.value).toBe('10')
  })

  it('resyncs the text to empty when the outside value clears', () => {
    const { dispatcher, getText } = makeDispatcher()
    render(dispatcher, { key: 'kv', value: 5 }, {}, () => {})
    render(dispatcher, { key: 'kv', value: undefined }, {}, () => {})
    expect(getText()).toBe('')
  })
})
