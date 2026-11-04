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

import type { ReactNode } from 'react'
import {
  GHOST_BUTTON,
  HELP_ROW_STYLE,
  INPUT_STYLE,
  PRIMARY_BUTTON,
  PROGRESS_STRIP_TRACK,
  progressStripFillStyle,
} from '../styles.ts'
import type { GetProgressState } from '../store/progress.ts'
import { react } from './react.ts'
import { injectStyles, SelectPill, type SelectItem } from './SelectPill.tsx'

// The primitives seed surface the card draws from. A member that is not a
// function (or a missing seed) falls back to the native control.
export interface PrimitivesModule {
  Menu?: unknown
  Button?: unknown
  Checkbox?: unknown
  StateDot?: unknown
  Progress?: unknown
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
      aria-valuenow={Math.max(0, Math.min(100, progress.percent))}
    >
      <div style={progressStripFillStyle(progress.percent)} />
    </div>
  )
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
