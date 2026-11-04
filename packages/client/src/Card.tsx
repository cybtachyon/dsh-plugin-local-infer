/**
 * The card composer: the browser card's single source of truth binding plus
 * the panel layout. It calls useCardStore (the only component that does),
 * renders every panel from the store snapshot, and wires every server
 * mutation through a performAction driver. The title-bar Launch/Stop control
 * renders from deriveLifecycleControl (the single lifecycle derivation), and
 * the debounced re-price (300 ms) is the only field-edit side effect.
 *
 * The card is a thin composer: the panels (the provider list, the deps panel,
 * the logs pane, the meter, the custom-args table, the chat-template field)
 * are their own components that take the store as a prop, and the form fields
 * (the renderField renderer) are drawn inline. Every panel and field renders
 * as a JSX element, never as a function call: a call would run the component's
 * hooks in the card's own hook context, and the card's hook count would vary
 * with the form model (a re-price that changes the field list then throws the
 * hook-order invariants 308/310). The card owns the store
 * binding, the field-edit callbacks (the draft edits and the debounced
 * re-price), and the action wiring (the save, discard, register, unregister,
 * launch, stop, download, and chat-template drivers).
 * @module dsh-plugin-local-infer/client/Card
 */

import type { ReactNode } from 'react'
import type { FormFieldModel, WarningModel } from 'dsh-plugin-local-infer/ui'
import {
  BANNER_STYLE,
  CARD_STYLE,
  FOOTER_STYLE,
  GHOST_BUTTON,
  HELP_BUTTON_STYLE,
  INLINE_WARNING_STYLE,
  INPUT_STYLE,
  LABEL_STYLE,
  ROW_STYLE,
  SECTION_STYLE,
  WARNING_BANNER_STYLE,
} from './styles.ts'
import { labels, type TextTable } from './text.ts'
import {
  renderButton,
  renderCheckbox,
  renderHelpRow,
  renderProcessButton,
  renderProgressStrip,
  renderSelect,
  type PrimitivesModule,
} from './render/primitives.tsx'
import { react } from './render/react.ts'
import { NumberField } from './render/NumberField.tsx'
import {
  ChatTemplateField,
  ChatTemplateStatusRow,
  useChatTemplateAutoDownload,
} from './render/ChatTemplateField.tsx'
import { Meter } from './render/Meter.tsx'
import { CustomArgsPanel } from './render/CustomArgsPanel.tsx'
import { DepsPanel } from './render/DepsPanel.tsx'
import { ProviderList } from './render/ProviderList.tsx'
import { LogsPanel } from './render/LogsPanel.tsx'
import { useCardStore } from './store/useCardStore.ts'
import type { CardDraft } from './store/types.ts'
import {
  deriveLifecycleControl,
  deriveProviderFormMode,
  type LifecycleControl,
} from './store/derive.ts'
import { repriceDeps, repriceSummary } from './store/deps.ts'
import {
  openEntryLogs,
  performDraftLaunch,
  performDraftStop,
  performEntryLaunch,
  performEntryStop,
} from './store/providers.ts'
import {
  performDiscard,
  performDownload,
  performRegister,
  performSave,
  performUnregister,
} from './store/actions.ts'
import { performGetCancel } from './store/deps.ts'
import { downloadTemplate } from './store/template.ts'

/**
 * LocaleService is the host locale seam the card reads the active locale
 * from. The dsh-client-locale plugin provides a LocaleRuntime under the
 * `locale` seam: getSnapshot().active is the active locale id, and subscribe
 * notifies on a locale switch so the card re-renders its label table.
 */
export interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

/**
 * LocaleRef is the locale handle the card reads the active locale from. The
 * bootstrap (plugin.ts) keeps it current through the locale seam and hands it
 * to the card, so the card draws the label table for the active locale.
 */
export interface LocaleRef {
  current: LocaleService | null
}

/** The field-edit callback the form fields run: one config key to a value. */
type OnValue = (key: string, value: unknown) => void

interface FieldProps {
  field: FormFieldModel
  onValue: OnValue
  inlineWarnings: WarningModel[]
  help: boolean
  t: TextTable
}

// renderField draws one form-model field: the control the field's control
// kind names (checkbox, dropdown, slider plus number, the chat-template combo,
// or a free-text input), the field label, the disabled reason, the help row,
// and the inline warnings anchored to the field. The combo field (the chat
// template) renders its own labeled rows, so it skips the outer label.
function renderField(props: FieldProps): ReactNode {
  const { field, onValue, inlineWarnings, help, t } = props
  const value = field.value
  const control = field.control
  let input: ReactNode
  let comboField = false
  if (control.kind === 'checkbox') {
    // The checkbox is a bare native control, not a field: it keeps the
    // browser's box size (the 32px input style would stretch it).
    input = (
      <input
        type="checkbox"
        checked={value === true}
        disabled={field.disabled}
        style={{
          accentColor: 'var(--dsw-alias-accent, #0a84ff)',
          colorScheme: 'light dark',
          opacity: field.disabled ? 0.5 : 1,
        }}
        onChange={(event: { target: { checked: boolean } }) =>
          onValue(field.key, event.target.checked)
        }
      />
    )
  } else if (control.kind === 'dropdown') {
    // The enum options plus the '' row the native select cleared with: the
    // pill's first menu row, the one an empty value selects.
    const dropdownItems = [
      { id: '', label: '—' },
      ...control.options.map((option) => ({
        id: String(option.value),
        label: option.note !== undefined ? option.label + ' · ' + option.note : option.label,
      })),
    ]
    const dropdownValue = value === undefined || value === null ? '' : String(value)
    const dropdownLabel =
      dropdownItems.find((item) => item.id === dropdownValue)?.label ?? '—'
    input = renderSelect({
      value: dropdownValue,
      label: dropdownLabel,
      items: dropdownItems,
      onSelect: (id) => onValue(field.key, id === '' ? undefined : id),
      disabled: field.disabled,
    })
  } else if (control.kind === 'slider') {
    // The readout is a number input, not a label: type a value or use the
    // spin buttons, and the slider and the estimate follow. The unit moves to
    // a small label beside the input, because a native number input cannot
    // carry suffix text. The range strip's cap is the hardware-priced
    // sliderMax when the form declares one, else the static max, else 100.
    const numeric = typeof value === 'number' ? value : undefined
    const sliderCap =
      control.sliderMax !== undefined
        ? control.sliderMax
        : control.max !== undefined
          ? control.max
          : 100
    const unitLabel = control.unit ? (
      <span
        style={{
          width: 48,
          flex: 'none',
          fontSize: 11,
          color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
        }}
      >
        {control.unit}
      </span>
    ) : null
    const numberControl: { min?: number; max?: number; step?: number } = {}
    if (control.min !== undefined) {
      numberControl.min = control.min
    }
    if (control.max !== undefined) {
      numberControl.max = control.max
    }
    if (control.step !== undefined) {
      numberControl.step = control.step
    }
    // A JSX element, not a function call: a call would run NumberField's
    // hooks in the card's own hook context, and the card's hook count would
    // vary with the field list (a re-price that changes the form model then
    // throws the hook-order invariants 308/310).
    const numberEntry: ReactNode = (
      <NumberField
        field={{ key: field.key, value: numeric, disabled: field.disabled }}
        control={numberControl}
        onValue={onValue}
      />
    )
    if (control.slider === false) {
      // A plain number entry: no range strip (the port field's case).
      input = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          {numberEntry}
          {unitLabel}
        </span>
      )
    } else {
      input = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <input
            type="range"
            style={{
              flex: 1,
              accentColor: 'var(--dsw-alias-accent, #0a84ff)',
              colorScheme: 'light dark',
            }}
            disabled={field.disabled}
            min={control.min !== undefined ? control.min : 0}
            max={sliderCap}
            step={control.step !== undefined ? control.step : 1}
            value={
              numeric !== undefined ? numeric : control.min !== undefined ? control.min : 0
            }
            onChange={(event: { target: { value: string } }) =>
              onValue(field.key, Number(event.target.value))
            }
          />
          {numberEntry}
          {unitLabel}
        </span>
      )
    }
  } else if (control.kind === 'combo') {
    // The chat template: a preset dropdown (shipped presets plus a Custom
    // entry) and a "Custom Chat template" text field that shows while the
    // preset is Custom. The ChatTemplateField owns both rows and the single
    // effective value, so the finicky free-text combo is gone.
    comboField = true
    input = (
      <ChatTemplateField
        field={{
          key: field.key,
          value: value === undefined || value === null ? '' : String(value),
          disabled: field.disabled,
        }}
        control={{
          options: control.options.map((option) => ({
            value: String(option.value),
            label: option.label,
            ...(option.note !== undefined ? { note: option.note } : {}),
          })),
        }}
        onValue={onValue}
        t={t}
      />
    )
  } else {
    // text and picker both render a free-text input; the browser has no
    // native directory picker, so the path is typed.
    const placeholder = control.kind === 'text' ? control.placeholder : undefined
    input = (
      <input
        type="text"
        style={{ ...INPUT_STYLE, ...(field.disabled ? { opacity: 0.5 } : {}) }}
        disabled={field.disabled}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={placeholder ?? ''}
        onChange={(event: { target: { value: string } }) => onValue(field.key, event.target.value)}
      />
    )
  }
  // A combo field renders its own labeled rows, so it skips the outer field
  // label and the disabled-reason span (the text field greys itself out while
  // disabled).
  const body = comboField ? (
    input
  ) : (
    <div style={ROW_STYLE}>
      <label style={LABEL_STYLE}>{field.label}</label>
      {input}
      {field.disabled && field.disabledReason ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
          }}
        >
          {field.disabledReason}
        </span>
      ) : null}
    </div>
  )
  return (
    <div style={{ marginTop: 6 }}>
      {body}
      {help ? renderHelpRow(field.description) : null}
      {inlineWarnings.map((warning) => (
        <div key={warning.id} style={INLINE_WARNING_STYLE(warning.tone)}>
          {warning.message}
        </div>
      ))}
    </div>
  )
}

// renderTitleBarControl draws the title-bar Launch/Stop control from the
// lifecycle spec: the phase throbber (no click), the ghost Stop, the red
// Logs, the getting throbber with the progress strip and the ghost Cancel,
// and the draft Launch/Stop. The 'getting' branch renders the throbber and
// the thin progress strip as one flex row: the readout button on the left,
// the strip stretching the remaining width, and the ghost Cancel (the
// performGetCancel driver) after the strip. A null progress renders no
// strip (the readout alone carries the branch).
function renderTitleBarControl(
  control: LifecycleControl,
  onControlClick: () => void,
  onCancel: () => void,
  cancelLabel: string,
): ReactNode {
  if (control.kind === 'phase') {
    return renderProcessButton({
      busy: true,
      label: control.label,
      busyLabel: control.busyLabel,
      variant: control.variant,
      onClick: () => {},
    })
  }
  if (control.kind === 'stop') {
    return renderButton('ghost', { onClick: onControlClick }, control.label)
  }
  if (control.kind === 'logs') {
    return (
      <button
        type="button"
        onClick={onControlClick}
        style={{ color: 'var(--dsw-alias-label-error, #ff3b30)', ...GHOST_BUTTON }}
        aria-label={control.label}
      >
        {control.label}
      </button>
    )
  }
  if (control.kind === 'getting') {
    return (
      <>
        {renderProcessButton({
          busy: control.busy,
          label: control.label,
          busyLabel: control.busyLabel,
          variant: control.variant,
          onClick: onControlClick,
          disabled: control.disabled,
        })}
        {renderProgressStrip(control.progress)}
        {renderButton('ghost', { onClick: onCancel }, cancelLabel)}
      </>
    )
  }
  return renderProcessButton({
    busy: control.busy,
    label: control.label,
    busyLabel: control.busyLabel,
    variant: control.variant,
    onClick: onControlClick,
    disabled: control.disabled,
  })
}

/**
 * card builds the browser card component factory. It has the same
 * (react, localeRef, primitives) shape as the placeholder the bootstrap used,
 * so plugin.ts swaps it in 1:1. The returned component calls useCardStore
 * (the only component that does), renders every panel from the store
 * snapshot, and wires every server mutation through a performAction driver.
 */
export function card(
  _react: unknown,
  localeRef: LocaleRef,
  _primitives: PrimitivesModule | null,
): () => ReactNode {
  // The locale service the host seam hands the card (null before the seam
  // fires). The card reads the active locale string through it and subscribes,
  // so a language switch re-renders the label table. Both closures are created
  // once per mount, so useSyncExternalStore does not re-subscribe each render.
  const subscribeLocale = (onChange: () => void): (() => void) => {
    const locale = localeRef.current
    return locale ? locale.subscribe(onChange) : () => {}
  }
  const readLocale = (): string => {
    const locale = localeRef.current
    return locale ? locale.getSnapshot().active : ''
  }

  return function Card(): ReactNode {
    const store = useCardStore()
    const state = store.getSnapshot()
    const active = react.useSyncExternalStore(subscribeLocale, readLocale, readLocale)
    const t = labels(active)

    // The latest committed draft, mirrored into a ref so the debounced
    // re-price reads the value the user last typed, not a stale closure.
    const draftRef = react.useRef<CardDraft | null>(null)
    const repriceTimerRef = react.useRef<ReturnType<typeof setTimeout> | null>(null)
    const draft = state.draft
    react.useEffect(() => {
      draftRef.current = draft
    }, [draft])

    // The debounced re-price: a field edit resets the 300 ms timer, and the
    // summary (the meter) and the deps panel re-fetch only after typing
    // pauses, so a fast keystroke stream is one round trip, not one per
    // letter. It is the only field-edit side effect.
    const scheduleReprice = (): void => {
      if (repriceTimerRef.current !== null) {
        clearTimeout(repriceTimerRef.current)
      }
      repriceTimerRef.current = setTimeout(() => {
        const latest = draftRef.current
        if (latest === null) {
          return
        }
        void repriceSummary(store, { engine: latest.engine, config: latest.config })
        void repriceDeps(store, { engine: latest.engine, config: latest.config })
      }, 300)
    }

    // The initial load: with no summary and no draft, fetch the read model
    // and the deps panel from the stored config.
    react.useEffect(() => {
      const current = store.getSnapshot()
      if (current.summary === null && current.draft === null) {
        void repriceSummary(store)
        void repriceDeps(store)
      }
      return () => {
        if (repriceTimerRef.current !== null) {
          clearTimeout(repriceTimerRef.current)
        }
      }
      // The mount effect runs once; the store binding re-renders on a
      // dispatch, so the load guard reads the live snapshot.
    }, [])

    // The chat-template auto-download: fires once when the summary reports an
    // absent template the CLI can pull.
    useChatTemplateAutoDownload(store)

    // The field-edit callbacks. onValue updates the draft config and schedules
    // the debounced re-price; onEngine resets the config for a new engine;
    // onModelDirectory auto-fills the first default model; onPlatform edits
    // the per-engine platform entry (no re-price: the platform drives the
    // deploy step only).
    const onValue: OnValue = (key, value) => {
      const current = store.getSnapshot()
      const currentDraft = current.draft
      if (currentDraft === null) {
        return
      }
      store.dispatch({
        type: 'draft/edit',
        draft: {
          engine: currentDraft.engine,
          config: { ...currentDraft.config, [key]: value },
          ...(currentDraft.platform !== undefined ? { platform: currentDraft.platform } : {}),
        },
      })
      scheduleReprice()
    }
    const onEngine = (engine: string): void => {
      const current = store.getSnapshot()
      const currentDraft = current.draft
      if (currentDraft === null) {
        return
      }
      store.dispatch({
        type: 'draft/edit',
        draft: {
          engine,
          config: {},
          ...(currentDraft.platform !== undefined ? { platform: currentDraft.platform } : {}),
        },
      })
      scheduleReprice()
    }
    const onModelDirectory = (value: string): void => {
      const trimmed = value === undefined || value === null ? '' : String(value).trim()
      onValue('modelDirectory', trimmed === '' ? undefined : trimmed)
      const current = store.getSnapshot()
      const currentModel =
        current.draft !== null && typeof current.draft.config.model === 'string'
          ? current.draft.config.model
          : ''
      const firstDefault = (current.summary?.modelDefaults ?? [])[0]
      if (
        trimmed !== '' &&
        !/\s/.test(trimmed) &&
        currentModel === '' &&
        firstDefault !== undefined
      ) {
        onValue('model', firstDefault.id)
      }
    }
    const onPlatform = (field: string, value: string | undefined): void => {
      const current = store.getSnapshot()
      const currentDraft = current.draft
      if (currentDraft === null) {
        return
      }
      const enginePlatform = {
        ...(currentDraft.platform?.[currentDraft.engine] ?? {}),
        [field]: value,
      }
      const platform = { ...(currentDraft.platform ?? {}), [currentDraft.engine]: enginePlatform }
      store.dispatch({
        type: 'draft/edit',
        draft: {
          engine: currentDraft.engine,
          config: currentDraft.config,
          platform,
        },
      })
    }

    // The title-bar control's click: route to the owning action (the provider
    // entry's machine, or the draft's action cells) per the derivation.
    const editingId = state.ui.editingProviderId
    const editedProvider =
      editingId !== null
        ? (state.summary?.providers ?? []).find((provider) => provider.id === editingId)
        : undefined
    const control = deriveLifecycleControl(state, t)
    const onControlClick = (): void => {
      if (control.target === 'entry' && editedProvider !== undefined) {
        if (control.action === 'stop') {
          performEntryStop(store, editedProvider)
        } else if (control.action === 'logs') {
          openEntryLogs(store, editedProvider)
        } else if (control.action === 'launch') {
          performEntryLaunch(store, editedProvider, t)
        }
      } else if (control.target === 'draft') {
        if (control.action === 'launch') {
          void performDraftLaunch(store, t)
        } else if (control.action === 'stop') {
          void performDraftStop(store, t)
        }
      }
    }

    // The loading state: with no summary and no draft, the card shows the
    // load line (the note, or the loading label).
    if (state.summary === null && state.draft === null) {
      return (
        <div style={CARD_STYLE}>
          <div>{state.summaryNote !== '' ? state.summaryNote + ' ' + t.retry : t.loading}</div>
        </div>
      )
    }

    const summary = state.summary
    const currentDraft = state.draft
    if (summary === null || currentDraft === null) {
      return (
        <div style={CARD_STYLE}>
          <div>{state.summaryNote !== '' ? state.summaryNote + ' ' + t.retry : t.loading}</div>
        </div>
      )
    }

    const formModel = summary.formModel
    const hasFields = formModel.sections.some((section) => section.fields.length > 0)
    const inlineWarnings = summary.warningsModel?.inline ?? {}
    const banner = summary.warningsModel?.banner
    const providerFormMode = deriveProviderFormMode(state)

    // The engine entry the build-mode and platform rows price.
    const engineEntry = (summary.engines ?? []).find((entry) => entry.id === currentDraft.engine)
    const buildModes: string[] = []
    if (engineEntry?.supports.local) {
      buildModes.push('local')
    }
    if (engineEntry?.supports.docker) {
      buildModes.push('docker')
    }
    const buildMode =
      typeof currentDraft.config.buildMode === 'string'
        ? currentDraft.config.buildMode
        : buildModes[0] ?? 'local'
    const enginePlatform = (currentDraft.platform ?? {})[currentDraft.engine] ?? {}

    // The model value and the model items the Model dropdown offers.
    const modelValue =
      typeof currentDraft.config.model === 'string' ? currentDraft.config.model : ''
    const modelItems = [
      { id: '', label: t.modelAuto },
      ...(summary.modelDefaults ?? []).map((model) => ({ id: model.id, label: model.label })),
      ...(summary.modelFiles ?? []).map((file) => ({ id: file, label: file })),
    ]

    // The download and register cells the form's notes render from.
    const downloadCell = state.actions.download
    const registerCell = state.actions.register
    const unregisterCell = state.actions.unregister
    const launchCell = state.actions.launch
    const stopCell = state.actions.stop

    return (
      <div style={CARD_STYLE}>
        <style>
          {'@keyframes dsh-local-infer-spin { to { transform: rotate(360deg); } }' +
            '@keyframes dsh-local-infer-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }'}
        </style>
        {summary.unsureBanner !== null && summary.unsureBanner !== undefined ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              backgroundColor: 'var(--dsw-alias-surface-secondary, rgba(0,0,0,0.04))',
              border: '1px solid var(--dsw-alias-stroke-secondary, rgba(0,0,0,0.08))',
            }}
          >
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.8))',
                whiteSpace: 'pre-line',
              }}
            >
              {summary.unsureBanner.message}
            </div>
            {summary.unsureBanner.killCommands.length > 0 ? (
              <textarea
                readOnly
                value={summary.unsureBanner.killCommands.join('\n')}
                style={{
                  marginTop: 8,
                  width: '100%',
                  minHeight: 48,
                  fontSize: 11,
                  fontFamily: 'var(--dsw-alias-font-mono, monospace)',
                  colorScheme: 'light dark',
                  resize: 'vertical',
                }}
              />
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>{t.section}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              style={HELP_BUTTON_STYLE(false)}
              title={t.refresh}
              aria-label={t.refresh}
              onClick={() => {
                void repriceSummary(store)
                void repriceDeps(store)
              }}
            >
              {'↻'}
            </button>
            <button
              type="button"
              style={HELP_BUTTON_STYLE(state.ui.help)}
              title={t.helpToggle}
              aria-label={t.helpToggle}
              aria-pressed={state.ui.help}
              onClick={() => {
                store.dispatch({
                  type: 'ui/patch',
                  patch: { help: !state.ui.help },
                })
                void performSave(store, t)
              }}
            >
              {'?'}
            </button>
          </div>
        </div>
        <ProviderList store={store} t={t} />
        {providerFormMode !== 'collapsed' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={ROW_STYLE}>
              <label style={LABEL_STYLE}>{t.engine}</label>
              {renderSelect({
                value: currentDraft.engine,
                label:
                  (summary.engines ?? []).find((entry) => entry.id === currentDraft.engine)
                    ?.label ?? currentDraft.engine,
                items: (summary.engines ?? []).map((engine) => ({
                  id: engine.id,
                  label: engine.label,
                })),
                onSelect: (id) => onEngine(id),
              })}
            </div>
            {state.ui.help ? renderHelpRow(t.engineHelp) : null}
            {(summary.modelDefaults ?? []).length > 0 || (summary.modelFiles ?? []).length > 0 ? (
              <div>
                <div style={ROW_STYLE}>
                  <label style={LABEL_STYLE}>{t.model}</label>
                  {renderSelect({
                    value: modelValue,
                    label:
                      modelItems.find((item) => item.id === modelValue)?.label ?? t.modelAuto,
                    items: modelItems,
                    onSelect: (id) => onValue('model', id === '' ? undefined : id),
                  })}
                </div>
                {state.ui.help ? renderHelpRow(t.modelHelp) : null}
              </div>
            ) : null}
            {buildModes.length > 0 ? (
              <div>
                <div style={ROW_STYLE}>
                  <label style={LABEL_STYLE}>{t.build}</label>
                  {renderSelect({
                    value: buildMode,
                    label:
                      buildModes.find((mode) => mode === buildMode) === 'local'
                        ? t.buildLocal
                        : t.buildDocker,
                    items: buildModes.map((mode) => ({
                      id: mode,
                      label: mode === 'local' ? t.buildLocal : t.buildDocker,
                    })),
                    onSelect: (id) => onValue('buildMode', id),
                  })}
                </div>
                {state.ui.help ? renderHelpRow(t.buildHelp) : null}
              </div>
            ) : null}
            <div>
              <div style={ROW_STYLE}>
                <label style={LABEL_STYLE}>{t.modelDirectory}</label>
                <input
                  style={INPUT_STYLE}
                  type="text"
                  value={
                    typeof currentDraft.config.modelDirectory === 'string'
                      ? currentDraft.config.modelDirectory
                      : ''
                  }
                  placeholder={t.dirPlaceholder}
                  onChange={(event: { target: { value: string } }) =>
                    onModelDirectory(event.target.value)
                  }
                />
              </div>
              {state.ui.help ? renderHelpRow(t.modelDirHelp) : null}
            </div>
            {summary.modelStatus !== null && summary.modelStatus !== undefined && !summary.modelStatus.present
              ? summary.modelStatus.hfCli ? (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      wordBreak: 'break-all',
                      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
                    }}
                  >
                    {t.hfCliDetected + ' ' + summary.modelStatus.downloadCommand}
                  </span>
                  {renderProcessButton({
                    busy: downloadCell.status === 'pending',
                    label: t.download,
                    busyLabel: t.downloading,
                    variant: 'ghost',
                    onClick: () => {
                      void performDownload(store, t)
                    },
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {t.noHfCli + ' '}
                  <a
                    href={summary.modelStatus.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--dsw-alias-accent, #0a84ff)' }}
                  >
                    {summary.modelStatus.url}
                  </a>
                </div>
              )
              : null}
            {downloadCell.status !== 'idle' && downloadCell.detail !== '' ? (
              <div style={{ fontSize: 12 }}>
                {downloadCell.status === 'ok' ? t.downloaded : t.downloadFailed}
                {downloadCell.detail !== t.downloaded && downloadCell.detail !== ''
                  ? ': ' + downloadCell.detail
                  : ''}
              </div>
            ) : null}
            {summary.chatTemplateStatus !== null &&
            summary.chatTemplateStatus !== undefined &&
            !summary.chatTemplateStatus.present
              ? (
                <ChatTemplateStatusRow
                  status={summary.chatTemplateStatus}
                  cell={state.templateActions.download}
                  onDownload={() => {
                    const status = store.getSnapshot().summary?.chatTemplateStatus
                    if (status !== null && status !== undefined) {
                      void downloadTemplate(store, status.repo)
                    }
                  }}
                  t={t}
                />
              )
              : null}
            <div>
              <div style={SECTION_STYLE}>{t.enginePlatform}</div>
              <div style={ROW_STYLE}>
                <label style={LABEL_STYLE}>{t.engineDirectory}</label>
                <input
                  style={INPUT_STYLE}
                  type="text"
                  value={
                    typeof enginePlatform.engineDirectory === 'string'
                      ? enginePlatform.engineDirectory
                      : ''
                  }
                  placeholder={t.dirPlaceholder}
                  onChange={(event: { target: { value: string } }) =>
                    onPlatform(
                      'engineDirectory',
                      event.target.value === '' ? undefined : event.target.value,
                    )
                  }
                />
              </div>
              {state.ui.help ? renderHelpRow(t.engineDirHelp) : null}
              <div style={ROW_STYLE}>
                <label style={LABEL_STYLE}>{t.engineFork}</label>
                <input
                  style={INPUT_STYLE}
                  type="text"
                  value={
                    typeof enginePlatform.engineFork === 'string'
                      ? enginePlatform.engineFork
                      : ''
                  }
                  placeholder={t.forkPlaceholder}
                  onChange={(event: { target: { value: string } }) =>
                    onPlatform(
                      'engineFork',
                      event.target.value === '' ? undefined : event.target.value,
                    )
                  }
                />
              </div>
              {state.ui.help ? renderHelpRow(t.engineForkHelp) : null}
              {buildMode === 'local' ? (
                <div>
                  <div style={ROW_STYLE}>
                    <label style={LABEL_STYLE}>{t.buildCommands}</label>
                    <input
                      style={INPUT_STYLE}
                      type="text"
                      value={
                        typeof enginePlatform.buildCommands === 'string'
                          ? enginePlatform.buildCommands
                          : ''
                      }
                      placeholder={
                        engineEntry?.defaultBuildCommand !== undefined
                          ? engineEntry.defaultBuildCommand
                          : ''
                      }
                      onChange={(event: { target: { value: string } }) =>
                        onPlatform(
                          'buildCommands',
                          event.target.value === '' ? undefined : event.target.value,
                        )
                      }
                    />
                  </div>
                  {state.ui.help ? renderHelpRow(t.buildCommandsHelp) : null}
                </div>
              ) : null}
              {buildMode === 'docker' ? (
                <div>
                  <div style={ROW_STYLE}>
                    <label style={LABEL_STYLE}>{t.dockerTag}</label>
                    <input
                      style={INPUT_STYLE}
                      type="text"
                      value={
                        typeof enginePlatform.dockerTag === 'string'
                          ? enginePlatform.dockerTag
                          : ''
                      }
                      placeholder={
                        engineEntry?.defaultDockerTag !== undefined
                          ? engineEntry.defaultDockerTag
                          : ''
                      }
                      onChange={(event: { target: { value: string } }) =>
                        onPlatform(
                          'dockerTag',
                          event.target.value === '' ? undefined : event.target.value,
                        )
                      }
                    />
                  </div>
                  {state.ui.help ? renderHelpRow(t.dockerTagHelp) : null}
                </div>
              ) : null}
            </div>
            {hasFields
              ? formModel.sections.map((section) => (
                  <div key={section.group}>
                    <div style={SECTION_STYLE}>{section.group}</div>
                    {section.fields.map((field) => {
                      // The field value binds to the local draft, not the server
                      // render model, so a typed keystroke shows in the input
                      // immediately. The server model (field.value) resolves the
                      // spec default and only surfaces after the debounced
                      // re-price settles. A key the user has not edited is
                      // absent from the draft, so it falls back to the model.
                      const draftValue = currentDraft.config[field.key]
                      const effectiveField =
                        draftValue !== undefined
                          ? { ...field, value: draftValue }
                          : field
                      return (
                        <div key={field.key}>
                          {renderField({
                            field: effectiveField,
                            onValue,
                            inlineWarnings: inlineWarnings[field.key] ?? [],
                            help: state.ui.help,
                            t,
                          })}
                        </div>
                      )
                    })}
                  </div>
                ))
              : (
                <div style={{ fontSize: 12, opacity: 0.7 }}>{t.noParameters}</div>
              )}
            {banner?.visible ? (
              <div
                style={WARNING_BANNER_STYLE(
                  banner.level === 'error' ? 'red' : banner.level === 'warn' ? 'amber' : 'neutral',
                )}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {banner.count +
                    ' ' +
                    (banner.count === 1 ? t.guidelineOne : t.guidelineMany) +
                    ' ' +
                    t.fired}
                </div>
                {banner.warnings.map((warning) => (
                  <div key={warning.id}>{warning.message}</div>
                ))}
              </div>
            ) : null}
            <Meter meter={summary.meterModel} t={t} />
            {summary.meterModel.source === 'not-measured' &&
            (summary.models ?? []).length > 0 &&
            !currentDraft.config.model ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                }}
              >
                {t.measureHint}
              </div>
            ) : null}
            {summary.verdict && (summary.verdict.status === 'over' || summary.verdict.status === 'tight') ? (
              <div style={BANNER_STYLE(summary.verdict.status)}>
                {(summary.verdict.status === 'over' ? t.over : t.tight) +
                  ': ' +
                  summary.verdict.detail}
              </div>
            ) : null}
            <CustomArgsPanel store={store} t={t} />
            <DepsPanel store={store} t={t} />
            <LogsPanel store={store} t={t} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              {renderTitleBarControl(
                control,
                onControlClick,
                () => performGetCancel(store),
                t.cancel,
              )}
              {renderCheckbox({
                checked: state.ui.autoRebuild,
                onChange: (next) => {
                  store.dispatch({ type: 'ui/patch', patch: { autoRebuild: next } })
                },
                label: t.autoRebuild,
              })}
            </div>
            {launchCell.status === 'error' && launchCell.detail !== '' ? (
              <div style={{ fontSize: 12 }}>
                {launchCell.detail === 'timeout'
                  ? t.launchFailed
                  : launchCell.detail}
              </div>
            ) : null}
            {stopCell.status === 'error' && stopCell.detail !== '' ? (
              <div style={{ fontSize: 12 }}>
                {stopCell.detail === 'timeout' ? t.stopFailed : stopCell.detail}
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              {renderButton(
                'ghost',
                {
                  onClick: () => {
                    void performRegister(store, t)
                  },
                  disabled: registerCell.status === 'pending' || state.dirty,
                },
                t.register,
              )}
              {renderCheckbox({
                checked: state.ui.agentDefault,
                onChange: (next) => {
                  store.dispatch({ type: 'ui/patch', patch: { agentDefault: next } })
                },
                label: t.registerDefault,
              })}
              {summary.registered === true
                ? renderButton(
                    'ghost',
                    {
                      onClick: () => {
                        void performUnregister(store, t)
                      },
                      disabled: unregisterCell.status === 'pending',
                    },
                    t.unregister,
                  )
                : null}
            </div>
            {state.dirty && state.ui.help ? renderHelpRow(t.registerNeedsSave) : null}
            {registerCell.status !== 'idle' && registerCell.detail !== '' ? (
              <div style={{ fontSize: 12 }}>
                {registerCell.status === 'ok'
                  ? registerCell.detail
                  : t.registerFailed +
                    (registerCell.detail !== 'timeout' ? ': ' + registerCell.detail : '')}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={FOOTER_STYLE}>
          {renderButton(
            'ghost',
            {
              onClick: () => {
                performDiscard(store)
              },
            },
            t.discard,
          )}
          {renderButton(
            'primary',
            {
              onClick: () => {
                void performSave(store, t)
              },
              disabled: state.actions.save.status === 'pending',
            },
            state.actions.save.status === 'pending' ? t.saving : t.save,
          )}
        </div>
        {state.summaryNote !== '' ? <div style={{ fontSize: 12 }}>{state.summaryNote}</div> : null}
      </div>
    )
  }
}
