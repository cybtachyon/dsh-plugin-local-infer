import * as reactModule from 'react'
import type { MeterModel } from 'dsh-plugin-local-infer/ui'
import { beforeAll, describe, expect, it } from 'vitest'
import { Meter } from '../src/render/Meter.tsx'
import { SEGMENT_COLORS } from '../src/styles.ts'
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
// text reads the element tree's text content, so sibling text nodes a JSX
// expression emits as separate children read as one contiguous string.
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
const style = (e: El): Record<string, unknown> => e.props.style as Record<string, unknown>

// The meter model the tests draw: a 12 GiB card with a 6 GiB weights segment,
// a 3 GiB reserve at the far end, and no unknown engines.
const GIB = 1024 * 1024 * 1024
function meterModel(patch: Partial<MeterModel> = {}): MeterModel {
  return {
    segments: [
      { key: 'weights', label: 'Weights', bytes: 6 * GIB, percent: 50 },
      { key: 'kv', label: 'KV cache', bytes: GIB, percent: 8.3 },
      { key: 'overhead', label: 'Sequence state', bytes: 0.5 * GIB, percent: 4.2 },
      { key: 'workspace', label: 'Workspace', bytes: 1.5 * GIB, percent: 12.5 },
      { key: 'free', label: 'Free for more context', bytes: GIB, percent: 8.3 },
      { key: 'reserve', label: 'Reserved for the OS', bytes: 3 * GIB, percent: 25 },
    ],
    cardBytes: 12 * GIB,
    verdict: { status: 'fits', detail: 'fits' },
    largestFittingContext: 8192,
    source: 'measured',
    reserveSource: 'default',
    unknownEngines: null,
    ...patch,
  }
}

beforeAll(() => {
  setReactModule(reactModule as unknown as ReactLike)
})

describe('the VRAM meter (render/Meter.tsx)', () => {
  const t = TEXT.en

  it('renders nothing for a null model', () => {
    expect(Meter({ meter: null, t })).toBe(null)
  })

  it('renders the section title, bar, legend, and readout', () => {
    const root = el(Meter({ meter: meterModel(), t }))
    expect(root.type).toBe('div')
    const [title, bar, legend, readout] = children(root)
    expect(title.props.children).toBe(t.meterTitle)
    // The bar carries one segment per model segment, in bar order.
    const segments = children(bar)
    expect(segments).toHaveLength(6)
    expect(style(segments[0]).width).toBe('50%')
    expect(style(segments[0]).background).toBe(SEGMENT_COLORS.weights)
    // The reserve segment is hatched, not a flat fill.
    expect(String(style(segments[5]).background)).toContain('repeating-linear-gradient')
    // The legend swatches read the segment palette.
    const legendItems = children(legend)
    expect(legendItems).toHaveLength(6)
    expect(style(children(legendItems[0])[0]).background).toBe(SEGMENT_COLORS.weights)
    expect(text(legendItems[0])).toBe('Weights')
    // The readout names the largest fitting context, the source, and the
    // reserve readout.
    expect(text(readout)).toContain(t.largestContext + ': 8192 ' + t.tokens)
    expect(text(readout)).toContain(t.meterSourceMeasured)
    expect(text(readout)).toContain(t.reserveReadout + ': 3.00 GiB ' + t.reserveDefault)
    // No unknown engines: the banner is absent.
    expect(children(root)).toHaveLength(4)
  })

  it('renders the unknown-engines banner when the model carries one', () => {
    const root = el(Meter({ meter: meterModel({ unknownEngines: { bytes: 4.5 * GIB } }), t }))
    const [, , , , banner] = children(root)
    const [bannerTitle, bannerBody] = children(banner)
    expect(bannerTitle.props.children).toBe(t.unknownEnginesTitle)
    expect(String(bannerBody.props.children)).toContain('4.50 GiB')
    expect(String(bannerBody.props.children)).toContain(t.unknownEnginesBody)
  })

  it('maps the source label for estimated and not-measured models', () => {
    for (const [source, label] of [
      ['estimated', t.meterSourceEstimated],
      ['not-measured', t.meterSourceNotMeasured],
    ] as const) {
      const root = el(Meter({ meter: meterModel({ source }), t }))
      const readout = children(root)[3]
      expect(text(readout)).toContain(label)
    }
  })

  it('maps the reserve source label for every reserveSource', () => {
    for (const [reserveSource, label] of [
      ['foreign-process', t.reserveForeign],
      ['gpu-usage', t.reserveGpuBusy],
      ['explicit', t.reserveExplicit],
    ] as const) {
      const root = el(Meter({ meter: meterModel({ reserveSource }), t }))
      const readout = children(root)[3]
      expect(text(readout)).toContain(t.reserveReadout + ': 3.00 GiB ' + label)
    }
  })

  it('renders the em-dash placeholder when no context fits', () => {
    const root = el(Meter({ meter: meterModel({ largestFittingContext: null }), t }))
    const readout = children(root)[3]
    expect(text(readout)).toContain('—')
  })

  it('seeds the segment tooltips with the segment label and GiB size', () => {
    const root = el(Meter({ meter: meterModel(), t }))
    const segments = children(children(root)[1])
    expect(segments[0].props.title).toBe('Weights: 6.00 GiB')
    expect(segments[5].props.title).toBe('Reserved for the OS: 3.00 GiB')
  })
})
