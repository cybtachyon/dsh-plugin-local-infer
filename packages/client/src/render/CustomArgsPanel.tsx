/**
 * The Custom Arguments panel: a three-column table of key/value rows the
 * user fills with extra launch flags, plus the + / - controls. The rows live
 * in the draft config's `customArgs` field, so a Save persists them and the
 * next engine launch appends them to the command line. The panel is a pure
 * draw of the rows; the row edits dispatch a draft/edit, so they stay in the
 * card's draft, not the panel.
 *
 * The first row is the permanent row: its "-" clears the key and value (it
 * never disappears, so the table always has at least one row). A lower row's
 * "-" removes that row entirely. Every row's "+" appends a fresh row.
 * @module dsh-plugin-local-infer/client/render/CustomArgsPanel
 */

import type { ReactNode } from 'react'
import type { CustomArg } from 'dsh-plugin-local-infer/ui'
import {
  CUSTOM_ARGS_BUTTONS_STYLE,
  CUSTOM_ARGS_GRID_STYLE,
  CUSTOM_ARGS_HEADER_STYLE,
  INPUT_STYLE,
  SECTION_STYLE,
} from '../styles.ts'
import type { TextTable } from '../text.ts'
import { react } from './react.ts'
import { renderButton, renderHelpRow } from './primitives.tsx'
import type { CardStore } from '../store/sync.ts'

/**
 * CustomArgAction names one row edit the Custom Arguments table runs:
 * 'key'/'value' edit a row, 'add' appends a row, 'clear' blanks the first
 * row (the permanent one), and 'remove' drops a lower row.
 */
export type CustomArgAction = 'key' | 'value' | 'add' | 'clear' | 'remove'

/**
 * normalizeCustomArgs reads the draft config's customArgs field (unknown,
 * because Config is a plain record) and returns the normalized rows: string
 * key/value pairs, with a single blank row when the field is absent, not an
 * array, or empty, so the table always has at least one row to fill.
 */
export function normalizeCustomArgs(raw: unknown): CustomArg[] {
  if (!Array.isArray(raw)) {
    return [{ key: '', value: '' }]
  }
  const rows: CustomArg[] = raw.map((entry): CustomArg => {
    const fields =
      entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    return {
      key: typeof fields.key === 'string' ? fields.key : '',
      value: typeof fields.value === 'string' ? fields.value : '',
    }
  })
  return rows.length > 0 ? rows : [{ key: '', value: '' }]
}

/**
 * nextCustomArgs applies one row edit to the draft config's customArgs field
 * and returns the next row list. It normalizes the field first, so a by-hand
 * edit never poisons the table, and keeps the at-least-one-row invariant:
 * removing the last lower row leaves a single blank row, and 'clear' blanks
 * the first row.
 */
export function nextCustomArgs(
  raw: unknown,
  action: CustomArgAction,
  index: number,
  value: string = '',
): CustomArg[] {
  let args = normalizeCustomArgs(raw)
  switch (action) {
    case 'key':
      args = args.map((entry, i) => (i === index ? { ...entry, key: value } : entry))
      break
    case 'value':
      args = args.map((entry, i) => (i === index ? { ...entry, value } : entry))
      break
    case 'add':
      args = [...args, { key: '', value: '' }]
      break
    case 'clear':
      args = [{ key: '', value: '' }, ...args.slice(1)]
      break
    case 'remove':
      args = args.filter((_entry, i) => i !== index)
      if (args.length === 0) {
        args = [{ key: '', value: '' }]
      }
      break
  }
  return args
}

export interface CustomArgsPanelProps {
  store: CardStore
  t: TextTable
}

/**
 * CustomArgsPanel renders the Custom Arguments table. It reads the rows from
 * the draft config's customArgs field (the only form-value source) and
 * dispatches a draft/edit per row edit, so the rows survive a re-price and a
 * Save persists them. The help row shows while the card's help toggle is on.
 */
export function CustomArgsPanel(props: CustomArgsPanelProps): ReactNode {
  const { store, t } = props
  const state = store.getSnapshot()
  const draft = state.draft
  const rows = normalizeCustomArgs(draft !== null ? draft.config.customArgs : undefined)
  // The row edit reads the fresh snapshot, so a re-price landing between the
  // render and the click never clobbers the rows it prices.
  const edit = (action: CustomArgAction, index: number, value: string = ''): void => {
    const current = store.getSnapshot().draft
    if (current === null) {
      return
    }
    const config: typeof current.config = {
      ...current.config,
      customArgs: nextCustomArgs(current.config.customArgs, action, index, value),
    }
    store.dispatch({
      type: 'draft/edit',
      draft: {
        engine: current.engine,
        config,
        ...(current.platform !== undefined ? { platform: current.platform } : {}),
      },
    })
  }
  const body = rows.map((arg, index) => {
    const isFirst = index === 0
    return (
      <div key={'arg-row-' + index} style={{ display: 'contents' }}>
        <input
          type="text"
          style={INPUT_STYLE}
          value={arg.key}
          placeholder={t.customArgKeyPlaceholder}
          aria-label={t.customArgKeyHeader}
          onChange={(event: { target: { value: string } }) => edit('key', index, event.target.value)}
        />
        <input
          type="text"
          style={INPUT_STYLE}
          value={arg.value}
          placeholder={t.customArgValuePlaceholder}
          aria-label={t.customArgValueHeader}
          onChange={(event: { target: { value: string } }) =>
            edit('value', index, event.target.value)
          }
        />
        <div style={CUSTOM_ARGS_BUTTONS_STYLE}>
          {renderButton(
            'ghost',
            {
              type: 'button',
              onClick: () => edit('add', index),
              'aria-label': t.customArgAdd,
            },
            '+',
          )}
          {renderButton(
            'ghost',
            {
              type: 'button',
              onClick: () => edit(isFirst ? 'clear' : 'remove', index),
              'aria-label': isFirst ? t.customArgClear : t.customArgRemove,
            },
            '-',
          )}
        </div>
      </div>
    )
  })
  return (
    <div style={{ marginTop: 8 }}>
      <div style={SECTION_STYLE}>{t.customArgsTitle}</div>
      {state.ui.help ? renderHelpRow(t.customArgHelp) : null}
      <div style={{ ...CUSTOM_ARGS_GRID_STYLE, gridTemplateRows: 'auto' }}>
        <div style={CUSTOM_ARGS_HEADER_STYLE}>{t.customArgKeyHeader}</div>
        <div style={CUSTOM_ARGS_HEADER_STYLE}>{t.customArgValueHeader}</div>
        <div style={{ ...CUSTOM_ARGS_HEADER_STYLE, textAlign: 'right' }}>
          {t.customArgAddRemoveHeader}
        </div>
        {body}
      </div>
    </div>
  )
}
