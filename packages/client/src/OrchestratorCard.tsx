/**
 * The Orchestrator card: the prompt editor the orchestrator component's
 * configuration page renders.
 *
 * The card owns its own small state (no card store): it loads the model from
 * GET /local-infer/orchestrator on mount, binds the textarea to the local
 * edit (the model's prompt until the first keystroke), and posts the edit to
 * POST /local-infer/orchestrator/save. The save route answers with the fresh
 * model, so the card re-reads prompt and defaultPrompt from one response. An
 * empty saved prompt clears the override back to the shipped prompt.md
 * default (the route's rule), which is what the note under the field says.
 *
 * The bootstrap (plugin.ts) mounts this card only when the orchestrator
 * route exists, which is exactly when the component is enabled; the slot
 * host renders the component with its own props (view, form), which this
 * card ignores: the prompt persists through the orchestrator's own routes,
 * not the host form.
 * @module dsh-plugin-local-infer/client/OrchestratorCard
 */

import type { CSSProperties, ReactNode } from 'react'
import { CARD_STYLE, FOOTER_STYLE } from './styles.ts'
import { labels } from './text.ts'
import { renderButton } from './render/primitives.tsx'
import { react } from './render/react.ts'
import { fetchOrchestrator, postOrchestratorSave, type OrchestratorModel } from './api/routes.ts'
import type { LocaleRef } from './Card.tsx'

// One settled save note: 'ok' reads the saved label, 'error' the host's own
// message. Any other interaction clears it.
interface SaveNote {
  kind: 'ok' | 'error'
  message: string
}

// The field body: a label above the textarea (the 120px row label would
// float beside a multi-line field).
const FIELD_LABEL_STYLE: CSSProperties = {
  display: 'block',
  color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
  marginBottom: 4,
}

// The prompt textarea reads the Input atom's field tokens (like INPUT_STYLE)
// with the monospace stack the card's other editable blobs use, so the
// prompt text keeps its layout in both themes.
const PROMPT_TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 160,
  padding: 8,
  borderRadius: 'var(--dsw-radius-md, 8px)',
  border:
    '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
  background:
    'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
  fontSize: 12,
  lineHeight: 1.5,
  colorScheme: 'light dark',
  resize: 'vertical',
}

// The quiet note under the field: the restore-the-default rule and (on an
// error) the host's message read in the tertiary label.
const NOTE_STYLE: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  marginTop: 4,
  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
}

/**
 * orchestratorCard builds the Orchestrator card component. It has the same
 * (react, localeRef) factory shape as the main card(), so the bootstrap
 * resolves the runtime externals once per mount path and hands them in the
 * same way; the button draws the primitives seed through the shared seam.
 */
export function orchestratorCard(
  _react: unknown,
  localeRef: LocaleRef,
): () => ReactNode {
  // The locale closures are created once per mount (the same pattern as
  // card()), so useSyncExternalStore does not re-subscribe each render.
  const subscribeLocale = (onChange: () => void): (() => void) => {
    const locale = localeRef.current
    return locale ? locale.subscribe(onChange) : () => {}
  }
  const readLocale = (): string => {
    const locale = localeRef.current
    return locale ? locale.getSnapshot().active : ''
  }

  return function OrchestratorCard(): ReactNode {
    const active = react.useSyncExternalStore(subscribeLocale, readLocale, readLocale)
    const t = labels(active)
    const [model, setModel] = react.useState<OrchestratorModel | null>(null)
    // The load failure the loading branch shows in place of the load line.
    const [loadError, setLoadError] = react.useState('')
    // The textarea's local edit: null until the user types, so the field
    // reads the server model before the first keystroke.
    const [draft, setDraft] = react.useState<string | null>(null)
    const [saving, setSaving] = react.useState(false)
    const [note, setNote] = react.useState<SaveNote | null>(null)

    // The initial load of { prompt, defaultPrompt, saved }.
    react.useEffect(() => {
      fetchOrchestrator().then(setModel, (error: unknown) => {
        setLoadError(String((error as Error)?.message ?? error))
      })
    }, [])

    const value = draft !== null ? draft : (model?.prompt ?? '')
    const onSave = (): void => {
      setSaving(true)
      setNote(null)
      postOrchestratorSave({ prompt: value }).then(
        (fresh) => {
          setModel(fresh)
          setDraft(null)
          setSaving(false)
          setNote({ kind: 'ok', message: '' })
        },
        (error: unknown) => {
          setSaving(false)
          setNote({ kind: 'error', message: String((error as Error)?.message ?? error) })
        },
      )
    }

    return (
      <div style={CARD_STYLE}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t.orchestratorSection}</div>
        {model === null ? (
          <div>{loadError !== '' ? loadError : t.loading}</div>
        ) : (
          <div>
            <div>
              <label style={FIELD_LABEL_STYLE}>{t.orchestratorPrompt}</label>
              <textarea
                style={PROMPT_TEXTAREA_STYLE}
                value={value}
                placeholder={model.defaultPrompt}
                disabled={saving}
                onChange={(event: { target: { value: string } }) =>
                  setDraft(event.target.value)
                }
              />
              <div style={NOTE_STYLE}>{t.orchestratorDefaultNote}</div>
            </div>
            <div style={FOOTER_STYLE}>
              {renderButton(
                'primary',
                { onClick: onSave, disabled: saving },
                saving ? t.saving : t.save,
              )}
            </div>
            {note === null ? null : (
              <div
                style={{
                  fontSize: 12,
                  color:
                    note.kind === 'error'
                      ? 'var(--dsw-alias-label-error, #ff3b30)'
                      : 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
                }}
              >
                {note.kind === 'ok' ? t.saved : note.message}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
}
