/**
 * The form's server-mutation drivers: the Save, Discard, Register, Remove,
 * and Download actions the card's footer and DSH model row run.
 *
 * Every server mutation rides performAction as a pending -> ack | timeout
 * transition over the store's action cells, the way the deps and provider
 * drivers do. The Discard is local-only (no server round trip): it reverts
 * the draft to the summary's stored values and re-prices the meter and deps
 * panel. The Save upserts a provider entry (editing an existing entry updates
 * it in place, a new entry mints an id and prepends it), and the Register and
 * Remove publish and pull the DSH model row through the settings seam. The
 * Download pulls the selected model into the model directory through the hf
 * CLI.
 * @module dsh-plugin-local-infer/client/store/actions
 */

import {
  postDownload,
  postRegister,
  postSave,
  postUnregister,
} from '../api/routes.ts'
import type { TextTable } from '../text.ts'
import { repriceAll } from './deps.ts'
import { abandonedFormPatch } from './providers.ts'
import { ACTION_TIMEOUTS, performAction, type CardStore } from './sync.ts'

/**
 * performSave upserts the provider entry the form edits through the save
 * route: editing an existing provider (a non-null id) updates it in place, a
 * new provider (a null id) mints an id and prepends it. On the ack it stores
 * the fresh summary and collapses the form back to the provider entry list,
 * so the saved provider shows as a card and the "New provider" control is
 * clickable again.
 */
export function performSave(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  const draft = state.draft
  if (draft === null) {
    return Promise.resolve()
  }
  const editingId = state.ui.editingProviderId
  return performAction(
    store,
    'save',
    () =>
      postSave({
        ...(editingId !== null ? { id: editingId } : {}),
        engine: draft.engine,
        config: draft.config,
        allowRunDeps: state.deps !== null && state.deps.runAllowed === true,
        platform: draft.platform ?? {},
        showHelp: state.ui.help,
        logPath: state.ui.logPath,
      }).then((summary) => {
        store.dispatch({ type: 'summary/ack', summary })
        store.dispatch({
          type: 'ui/patch',
          patch: { editingProviderId: null, providerFormMode: 'collapsed' },
        })
        return t.saved
      }),
    ACTION_TIMEOUTS.save,
  )
}

/**
 * performDiscard reverts the form to the summary's stored values (the draft
 * discard) and collapses it back to the provider entry list (the new-provider
 * form when the stored config has no entries). It re-prices the meter and
 * deps panel from the stored config, so the readouts return to the last-saved
 * state. Like the Cancel, the Discard abandons a draft run's sudo wait, so
 * the shared abandonedFormPatch clears the ui.sudoPending flag. It is
 * local-only: no server round trip.
 */
export function performDiscard(store: CardStore): void {
  store.dispatch({ type: 'draft/discard' })
  store.dispatch({ type: 'ui/patch', patch: abandonedFormPatch('collapsed') })
  void repriceAll(store)
}

/**
 * performRegister publishes the engine as a DSH model through the register
 * route, pointing the agent default model at the registered engine when the
 * checkbox is on. On a published entry it re-fetches both read models
 * (the summary and the deps panel) through repriceAll (the registered flag
 * flips to true and the Remove button appears) and reports the model and
 * provider ids it wrote. A refused write settles the cell to error with
 * the route's own message.
 */
export function performRegister(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  const draft = state.draft
  if (draft === null) {
    return Promise.resolve()
  }
  return performAction(
    store,
    'register',
    () =>
      postRegister({
        engine: draft.engine,
        config: draft.config,
        agentDefault: state.ui.agentDefault,
      }).then((result) => {
        if (result.ok && result.entry !== undefined) {
          void repriceAll(store, { engine: draft.engine, config: draft.config })
          return t.registered + ' ' + result.entry.modelId + ' as ' + result.entry.providerId
        }
        throw new Error(t.registerFailed + (result.detail ? ': ' + result.detail : ''))
      }),
    ACTION_TIMEOUTS.register,
  )
}

/**
 * performUnregister removes the DSH model row the register step wrote
 * through the unregister route, keyed off the same config so the removal
 * targets the exact entry the registration published. On a removal it
 * re-fetches both read models (the summary and the deps panel) through
 * repriceAll (the registered flag flips to false and the Remove button
 * disappears).
 */
export function performUnregister(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  const draft = state.draft
  if (draft === null) {
    return Promise.resolve()
  }
  return performAction(
    store,
    'unregister',
    () =>
      postUnregister({ engine: draft.engine, config: draft.config }).then((result) => {
        if (result.removed) {
          void repriceAll(store, { engine: draft.engine, config: draft.config })
          return t.unregistered
        }
        throw new Error(t.unregisterFailed)
      }),
    ACTION_TIMEOUTS.unregister,
  )
}

/**
 * performDownload pulls the selected model into the model directory through
 * the download route's hf CLI. On a successful pull it re-fetches both read
 * models (the summary and the deps panel) through repriceAll (the model
 * status row re-checks the directory and hides). A failed pull settles the
 * cell to error with the route's own detail.
 */
export function performDownload(store: CardStore, t: TextTable): Promise<void> {
  const state = store.getSnapshot()
  const draft = state.draft
  if (draft === null) {
    return Promise.resolve()
  }
  const model = typeof draft.config.model === 'string' ? draft.config.model : undefined
  const directory =
    typeof draft.config.modelDirectory === 'string' ? draft.config.modelDirectory : undefined
  return performAction(
    store,
    'download',
    () =>
      postDownload({
        engine: draft.engine,
        ...(model !== undefined ? { model } : {}),
        ...(directory !== undefined ? { directory } : {}),
      }).then((result) => {
        if (result.ok) {
          void repriceAll(store, { engine: draft.engine, config: draft.config })
          return t.downloaded
        }
        throw new Error(t.downloadFailed + (result.detail ? ': ' + result.detail : ''))
      }),
    ACTION_TIMEOUTS.download,
  )
}
