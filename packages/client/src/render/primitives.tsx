/**
 * The guarded primitive renderers: the card's select, button, checkbox,
 * state dot, throbber, and process button, each drawing the DSH primitives
 * seed when the host provides it and the native control it replaces
 * otherwise.
 *
 * The primitives seed (the shell's @deepseek-ai/dsh-client-ui-primitives) is
 * resolved once by the bootstrap (mountCard) and handed in through
 * setPrimitivesModule. A missing seed is a fallback, not an error: the ref
 * stays null and every renderer draws its native control, so the card renders
 * on a host whose platform table predates the seed.
 * @module dsh-plugin-local-infer/client/render/primitives
 */

import type { CSSProperties, ReactNode } from 'react'
import {
  GHOST_BUTTON,
  HELP_ROW_STYLE,
  INPUT_STYLE,
  PRIMARY_BUTTON,
  PROGRESS_STRIP_TRACK,
  clampPercent,
  progressStripFillStyle,
} from '../styles.ts'
import type { GetProgressState, StepTone } from '../store/progress.ts'
import { react } from './react.ts'
import { injectStyles, SelectPill, type SelectItem } from './SelectPill.tsx'

// The primitives seed surface the card draws from. A member that is not a
// function (or a missing seed) falls back to the native control.
export interface PrimitivesModule {
  Menu?: unknown
  Button?: unknown
  Checkbox?: unknown
  StateDot?: unknown
  // Forward-looking: the installed primitives seed exports no Progress
  // component, so renderProgressStrip's guard stays a fallback for a future
  // seed. If the seed adds one, the guard picks it up automatically.
  Progress?: unknown
  // Forward-looking: the installed primitives seed exports no Tag or
  // TextShimmer, so renderTag and renderTextShimmer's guards stay fallbacks
  // for a future seed (TASK-017 adds the members).
  Tag?: unknown
  TextShimmer?: unknown
  // Forward-looking: the installed primitives seed exports no Pill, so
  // renderPill's guard stays a fallback for a future seed (TASK-017 adds the
  // member).
  Pill?: unknown
  IconChevronDownOutlineRegular?: unknown
  IconRefreshOutlineRegular?: unknown
}

// The seed the bootstrap resolved. It stays null until setPrimitivesModule
// runs, so a render before the bootstrap wired it draws the native controls.
let primitivesRef: PrimitivesModule | null = null

/**
 * setPrimitivesModule hands the bootstrap's resolved primitives seed to the
 * renderers. mountCard calls it after its require of the seed, passing null
 * when the seed is absent (the native-control fallback).
 */
export function setPrimitivesModule(primitives: PrimitivesModule | null): void {
  primitivesRef = primitives
}

/** getPrimitivesModule returns the resolved seed, or null for the fallback. */
export function getPrimitivesModule(): PrimitivesModule | null {
  return primitivesRef
}

// The card's compact button variants. size stays the sm control: the card is
// a 28px context.
export type ButtonVariant = 'primary' | 'ghost'

// The state dot's semantic states (the DSH StateDot contract): green done,
// amber warning, red error, the spinner ongoing, neutral idle.
export type StateDotState = 'done' | 'warning' | 'error' | 'ongoing' | 'idle'

// The per-field description line: it sits under the input column in the
// tertiary label the disabled reason reads, so a two-line description stays a
// quiet annotation. An empty text renders nothing.
export function renderHelpRow(text: string | null | undefined): ReactNode {
  if (text === null || text === undefined || text === '') {
    return null
  }
  return <div style={HELP_ROW_STYLE}>{text}</div>
}

// The DSH Button atom (the --dsw-alias-button-* token families) with the
// card's inline button as the fallback a host without the seed keeps.
export function renderButton(
  variant: ButtonVariant | undefined,
  buttonProps: Record<string, unknown>,
  children: unknown,
): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Button === 'function') {
    return react.createElement(
      primitives.Button,
      { variant, size: 'sm', type: 'button', ...buttonProps },
      children,
    ) as ReactNode
  }
  return react.createElement(
    'button',
    { type: 'button', style: variant === 'primary' ? PRIMARY_BUTTON : GHOST_BUTTON, ...buttonProps },
    children,
  ) as ReactNode
}

// The DSH Checkbox atom (a native input with its visible label) with the
// card's inline label as the fallback.
export interface CheckboxProps {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function renderCheckbox(checkboxProps: CheckboxProps): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Checkbox === 'function') {
    return react.createElement(primitives.Checkbox, checkboxProps) as ReactNode
  }
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checkboxProps.checked}
        disabled={checkboxProps.disabled}
        onChange={(event) => checkboxProps.onChange(event.target.checked)}
      />
      {checkboxProps.label}
    </label>
  )
}

// The DSH StateDot semantics for the dep rows, with the card's colored glyphs
// as the fallback.
export function renderStateDot(state: StateDotState): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.StateDot === 'function') {
    return react.createElement(primitives.StateDot, { state }) as ReactNode
  }
  const glyph: Record<StateDotState, string> = {
    done: '✓',
    warning: '○',
    error: '✗',
    ongoing: '…',
    idle: '○',
  }
  const color: Record<StateDotState, string> = {
    done: '#34c38f',
    warning: 'var(--dsw-alias-label-warning, #ff9f0a)',
    error: 'var(--dsw-alias-label-error, #ff3b30)',
    ongoing: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    idle: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
  }
  return (
    <span style={{ color: color[state] || 'inherit', width: 12, flex: 'none' }} aria-hidden="true">
      {glyph[state] || '○'}
    </span>
  )
}

// The DSH loading indicator the per-entry Launch button shows while a launch
// is in flight: the StateDot ongoing spinner (the primitives' shared loader)
// with a CSS border-spin as the fallback a host without the seed keeps.
export function renderThrobber(): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.StateDot === 'function') {
    return react.createElement(primitives.StateDot, { state: 'ongoing', size: 12 }) as ReactNode
  }
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: '2px solid rgba(127,127,127,0.3)',
        borderTopColor: 'var(--dsw-alias-label-primary, #1d1d1f)',
        borderRadius: '50%',
        animation: 'dsh-local-infer-spin 0.8s linear infinite',
      }}
      aria-hidden="true"
    />
  )
}

// The 'getting' control's thin progress strip: the seed Progress when the
// host provides one (the current primitives package exports no Progress, so
// the guard stays a fallback for a future seed), the native track-and-fill
// divs on the --dsw tokens otherwise. A null state renders nothing: the
// readout alone carries the branch before the first bar update lands.
export function renderProgressStrip(progress: GetProgressState | null | undefined): ReactNode {
  if (progress === null || progress === undefined) {
    return null
  }
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Progress === 'function') {
    return react.createElement(primitives.Progress, { value: progress.percent }) as ReactNode
  }
  return (
    <div
      style={PROGRESS_STRIP_TRACK}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampPercent(progress.percent)}
    >
      <div style={progressStripFillStyle(progress.percent)} />
    </div>
  )
}

// The native Tag fallback's base chrome: a compact rounded pill the step
// chips and any future tag read as. The tone layer (the tagToneStyle map)
// paints the semantic color on top.
const TAG_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 8px',
  borderRadius: 10,
  fontSize: 11,
  lineHeight: 1,
  whiteSpace: 'nowrap',
}

// The native Tag fallback's tone layer: the semantic fill and label the four
// step tones read as, on the --dsw token families with a legacy fallback.
const TAG_TONE_STYLES: Record<StepTone, CSSProperties> = {
  success: {
    color: 'var(--dsw-alias-label-success, #34c38f)',
    background: 'var(--dsw-alias-fill-success, rgba(52,195,143,0.12))',
  },
  info: {
    color: 'var(--dsw-alias-accent, #0a84ff)',
    background: 'var(--dsw-alias-fill-accent, rgba(10,132,255,0.12))',
  },
  quiet: {
    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    background: 'var(--dsw-alias-background-tertiary, rgba(128,128,128,0.08))',
  },
  danger: {
    color: 'var(--dsw-alias-label-error, #ff3b30)',
    background: 'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))',
  },
}

// The native TextShimmer fallback: a background-clip text gradient that
// sweeps across the label, the running step chip's live read. The keyframe
// (dsh-local-infer-shimmer) is injected by the card's style element.
const SHIMMER_TEXT_STYLE: CSSProperties = {
  display: 'inline-block',
  background:
    'linear-gradient(90deg, var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8)) 30%, var(--dsw-alias-label-primary, #1d1d1f) 50%, var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8)) 70%)',
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  animation: 'dsh-local-infer-shimmer 1.6s linear infinite',
}

// The DSH Tag atom (a rounded semantic pill) with the card's native pill as
// the fallback a host without the seed keeps. The tone drives the semantic
// color; the seed's Tag takes the same tone contract.
export function renderTag(tone: StepTone, children: ReactNode): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Tag === 'function') {
    return react.createElement(primitives.Tag, { tone }, children) as ReactNode
  }
  return <span style={{ ...TAG_BASE_STYLE, ...TAG_TONE_STYLES[tone] }}>{children}</span>
}

// The DSH TextShimmer atom (a label with a sweeping highlight) with the
// card's CSS shimmer span as the fallback a host without the seed keeps. The
// running step chip wraps its label in it, so the live step reads as moving.
export function renderTextShimmer(children: ReactNode): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.TextShimmer === 'function') {
    return react.createElement(primitives.TextShimmer, null, children) as ReactNode
  }
  return <span style={SHIMMER_TEXT_STYLE}>{children}</span>
}

// The native Pill fallback's chrome: a compact rounded pill the Cancel
// affordance reads as on a host without the seed. It is a button, not a
// span, so the click the seed's Pill carries (the cancel handler) stays
// wired through the fallback.
const PILL_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 8px',
  borderRadius: 10,
  whiteSpace: 'nowrap',
  font: 'inherit',
  fontSize: 11,
  lineHeight: 1,
  cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
  background: 'transparent',
  color: 'inherit',
}

// The DSH Pill atom (a compact rounded label) with the card's native pill
// button as the fallback a host without the seed keeps. The seed's Pill
// takes the same label contract; the props (the click handler, the disabled
// state) pass through to it.
export function renderPill(label: string, pillProps: Record<string, unknown>): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Pill === 'function') {
    return react.createElement(primitives.Pill, { ...pillProps }, label) as ReactNode
  }
  return react.createElement(
    'button',
    { type: 'button', style: PILL_BUTTON_STYLE, ...pillProps },
    label,
  ) as ReactNode
}

// The reusable stateful process button: the Disable/Throbber/Reset lifecycle
// every process control (Get, Launch, Stop, Run, Download) shares. While the
// process is in flight (busy) it reads as a disabled control with the spinner
// and the in-progress label; when it settles the caller flips busy back to
// false and the control resets to the idle action button. A host without the
// seed keeps the native fallback through renderButton.
export interface ProcessButtonOpts {
  busy?: boolean
  label: string
  busyLabel: string
  variant?: ButtonVariant
  onClick?: () => void
  disabled?: boolean
}

export function renderProcessButton(opts: ProcessButtonOpts): ReactNode {
  if (opts.busy === true) {
    return (
      <button
        type="button"
        disabled
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7, ...GHOST_BUTTON }}
        aria-label={opts.busyLabel}
      >
        {renderThrobber()}
        <span>{opts.busyLabel}</span>
      </button>
    )
  }
  return renderButton(
    opts.variant,
    { onClick: opts.onClick, disabled: opts.disabled === true },
    opts.label,
  )
}

// One dropdown field. The DSH Menu pill when the host seeds the primitives,
// the native select it replaces otherwise. `items` are {id, label} rows;
// `value` is the selected id; `onSelect` receives the chosen id (an empty id
// clears the value, the native fallback's '' option behavior). `id` is the
// control's element id: the row's label associates through it with htmlFor,
// so a screen reader names the control from the label.
export interface SelectOpts {
  label: string
  items: SelectItem[]
  value: string
  onSelect: (id: string) => void
  disabled?: boolean
  id?: string
}

export function renderSelect(opts: SelectOpts): ReactNode {
  const primitives = getPrimitivesModule()
  if (primitives && typeof primitives.Menu === 'function') {
    injectStyles()
    return react.createElement(SelectPill, {
      Menu: primitives.Menu,
      Chevron: primitives.IconChevronDownOutlineRegular,
      label: opts.label,
      items: opts.items,
      selectedId: opts.value,
      onSelect: opts.onSelect,
      disabled: opts.disabled === true,
      id: opts.id,
    }) as ReactNode
  }
  return react.createElement(
    'select',
    {
      style: INPUT_STYLE,
      value: opts.value,
      disabled: opts.disabled === true,
      onChange: (event: { target: { value: string } }) => opts.onSelect(event.target.value),
      ...(opts.disabled === true ? { opacity: 0.5 } : {}),
      ...(opts.id !== undefined ? { id: opts.id } : {}),
    },
    ...opts.items.map((item) =>
      react.createElement('option', { key: item.id, value: item.id }, item.label),
    ),
  ) as ReactNode
}
