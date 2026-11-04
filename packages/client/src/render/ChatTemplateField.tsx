/**
 * The chat-template control, split from the old finicky free-text combo
 * into a preset dropdown (the shipped presets plus a "Custom" entry) and a
 * "Custom Chat template" text field that shows while the preset is Custom.
 * The single config value (the effective --chat-template) is derived: a
 * known preset value selects that preset, a non-preset value selects
 * Custom, and an empty value selects the blank row. The local custom-mode
 * flag keeps the text field open after a Custom selection even while the
 * value is still empty, so a fresh selection is ready to type.
 *
 * The absent-template hint (ChatTemplateStatusRow) shows while the selected
 * template is missing from the model directory: with the hf CLI detected it
 * names the download command and offers a Download button, without the CLI
 * it shows the command as copyable text. The auto-download effect
 * (useChatTemplateAutoDownload) fires that download once when the summary
 * reports an absent template the CLI can pull.
 *
 * Defined at module level, not inside a render function, so React keeps one
 * hook state per field instead of remounting on every render.
 * @module dsh-plugin-local-infer/client/render/ChatTemplateField
 */

import type { ReactNode } from 'react'
import type { ChatTemplateStatusModel } from 'dsh-plugin-local-infer/ui'
import { INPUT_STYLE, LABEL_STYLE, ROW_STYLE } from '../styles.ts'
import type { TextTable } from '../text.ts'
import { react } from './react.ts'
import { renderProcessButton, renderSelect } from './primitives.tsx'
import type { ActionState } from '../store/types.ts'
import type { CardStore } from '../store/sync.ts'
import { downloadTemplate } from '../store/template.ts'

// The field the ChatTemplateField edits: its key, its current draft value
// (the config value is unknown-typed, and the template value is a string
// the user typed or a preset picked), and the disabled flag the card's
// dirty gate sets.
export interface ChatTemplateFieldField {
  key: string
  value: string | null | undefined
  disabled?: boolean
}

// One preset row the combo control offers: the value the config stores, its
// display label, and the optional note (a model name, a size) the label
// carries after a middle dot.
export interface ChatTemplateOption {
  value: string
  label: string
  note?: string
}

// The combo control the field renders: the preset rows, absent for an
// engine with no shipped presets (the dropdown then offers only the blank
// row and Custom).
export interface ChatTemplateFieldControl {
  options?: readonly ChatTemplateOption[]
}

export interface ChatTemplateFieldProps {
  field: ChatTemplateFieldField
  control: ChatTemplateFieldControl
  onValue: (key: string, value: string | undefined) => void
  t: TextTable
}

/**
 * ChatTemplateField renders the preset select and the custom text row. The
 * preset select draws through renderSelect (the DSH Menu pill, or the
 * native select a host without the seed keeps); the custom row is a plain
 * text input the user types a local path or an HF repo reference into.
 */
export function ChatTemplateField(props: ChatTemplateFieldProps): ReactNode {
  const { field, control, onValue, t } = props
  const value = field.value
  const options = control.options ?? []
  const isPreset = options.some((option) => String(option.value) === String(value))
  const valueIsEmpty = value === undefined || value === null || value === ''
  // The custom-mode flag starts from the value: a non-preset, non-empty
  // value is a custom template, so the text field opens ready.
  const [customMode, setCustomMode] = react.useState(!valueIsEmpty && !isPreset)

  const presetItems = [
    { id: '', label: t.modelAuto },
    ...options.map((option) => ({
      id: String(option.value),
      label: option.note ? option.label + ' · ' + option.note : option.label,
    })),
    { id: 'custom', label: t.custom },
  ]
  const presetValue = isPreset && !valueIsEmpty ? String(value) : customMode ? 'custom' : ''
  const presetLabel = presetItems.find((item) => item.id === presetValue)?.label ?? t.modelAuto

  const customValue = valueIsEmpty ? '' : String(value)

  // The label association: each row's label carries its control's element id
  // through htmlFor, so a screen reader names the control from the label.
  // The ids are stable per field key, so a re-render keeps the association.
  const selectId = 'dsh-li-' + field.key
  const customId = 'dsh-li-' + field.key + '-custom'

  const presetSelect = renderSelect({
    value: presetValue,
    label: presetLabel,
    items: presetItems,
    id: selectId,
    onSelect: (id) => {
      if (id === 'custom') {
        // Switch to custom mode: keep the current custom value if it is
        // one, else start empty. The text field opens ready to type.
        setCustomMode(true)
        if (valueIsEmpty || isPreset) {
          onValue(field.key, '')
        }
      } else if (id === '') {
        setCustomMode(false)
        onValue(field.key, undefined)
      } else {
        setCustomMode(false)
        onValue(field.key, id)
      }
    },
    ...(field.disabled ? { disabled: true } : {}),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE} htmlFor={selectId}>
          {t.chatTemplatePreset}
        </label>
        {presetSelect}
      </div>
      {customMode ? (
        <div style={ROW_STYLE}>
          <label style={LABEL_STYLE} htmlFor={customId}>
            {t.customChatTemplate}
          </label>
          <input
            style={{ ...INPUT_STYLE, ...(field.disabled ? { opacity: 0.5 } : {}) }}
            id={customId}
            type="text"
            value={customValue}
            placeholder="local path or HF repo reference"
            disabled={field.disabled}
            onChange={(event: { target: { value: string } }) => onValue(field.key, event.target.value)}
          />
        </div>
      ) : null}
    </div>
  )
}

export interface ChatTemplateStatusRowProps {
  status: ChatTemplateStatusModel
  // The store's template-download cell: pending reads as the busy button,
  // ok and error read as the note line beneath the row.
  cell: ActionState
  onDownload: () => void
  t: TextTable
}

/**
 * ChatTemplateStatusRow renders the absent-template hint. It shows while
 * the selected template is missing from the model directory: with the hf
 * CLI detected it names the download command and offers the Download
 * button (the auto-download effect fires it first); without the CLI it
 * shows the command as copyable text, the same command the System
 * dependencies box carries. A present template renders nothing.
 */
export function ChatTemplateStatusRow(props: ChatTemplateStatusRowProps): ReactNode {
  const { status, cell, onDownload, t } = props
  if (status.present) {
    return null
  }
  const busy = cell.status === 'pending'
  // The cell detail stays neutral (the route's error, or the timeout
  // marker); the note maps it to the localized copy here.
  const note =
    cell.status === 'ok'
      ? t.templateDownloaded
      : cell.status === 'error'
        ? t.templateDownloadFailed + (cell.detail !== '' ? ': ' + cell.detail : '')
        : ''
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            wordBreak: 'break-all',
            fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
          }}
        >
          {(status.hfCli ? t.hfCliDetected : t.noHfCli) + ' ' + status.downloadCommand}
        </span>
        {status.hfCli
          ? renderProcessButton({
              busy,
              label: t.templateDownload,
              busyLabel: t.templateDownloading,
              variant: 'ghost',
              onClick: onDownload,
            })
          : null}
      </div>
      {note !== '' ? <div style={{ fontSize: 12 }}>{note}</div> : null}
    </div>
  )
}

/**
 * useChatTemplateAutoDownload fires the template download once when the
 * summary reports a selected template that is absent from the model
 * directory and the hf CLI is available, so a picked preset works out of
 * the box. A present template, a missing CLI (the System dependencies box
 * shows the command), an empty repo, and a download already in flight all
 * read as no-ops; the cell's pending guard is the double-fire protection.
 * The card owner (Card.tsx) calls the hook; the effect re-fires only when
 * the repo changes, the way the hand-written card's effect did.
 */
export function useChatTemplateAutoDownload(store: CardStore): void {
  const status = store.getSnapshot().summary?.chatTemplateStatus ?? null
  const repo = status?.repo ?? ''
  react.useEffect(() => {
    if (status === null || status.present || !status.hfCli || status.repo === '') {
      return
    }
    void downloadTemplate(store, status.repo)
  }, [repo])
}
