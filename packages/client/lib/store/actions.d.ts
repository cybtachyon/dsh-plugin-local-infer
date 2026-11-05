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
import type { TextTable } from '../text.ts';
import { type CardStore } from './sync.ts';
/**
 * performSave upserts the provider entry the form edits through the save
 * route: editing an existing provider (a non-null id) updates it in place, a
 * new provider (a null id) mints an id and prepends it. On the ack it stores
 * the fresh summary and collapses the form back to the provider entry list,
 * so the saved provider shows as a card and the "New provider" control is
 * clickable again.
 */
export declare function performSave(store: CardStore, t: TextTable): Promise<void>;
/**
 * performDiscard reverts the form to the summary's stored values (the draft
 * discard) and collapses it back to the provider entry list (the new-provider
 * form when the stored config has no entries). It re-prices the meter and
 * deps panel from the stored config, so the readouts return to the last-saved
 * state. Like the Cancel, the Discard abandons a draft run's sudo wait, so
 * the shared abandonedFormPatch clears the ui.sudoPending flag. It is
 * local-only: no server round trip.
 */
export declare function performDiscard(store: CardStore): void;
/**
 * performRegister publishes the engine as a DSH model through the register
 * route, pointing the agent default model at the registered engine when the
 * checkbox is on. On a published entry it re-fetches both read models
 * (the summary and the deps panel) through repriceAll (the registered flag
 * flips to true and the Remove button appears) and reports the model and
 * provider ids it wrote. A refused write settles the cell to error with
 * the route's own message.
 */
export declare function performRegister(store: CardStore, t: TextTable): Promise<void>;
/**
 * performUnregister removes the DSH model row the register step wrote
 * through the unregister route, keyed off the same config so the removal
 * targets the exact entry the registration published. On a removal it
 * re-fetches both read models (the summary and the deps panel) through
 * repriceAll (the registered flag flips to false and the Remove button
 * disappears).
 */
export declare function performUnregister(store: CardStore, t: TextTable): Promise<void>;
/**
 * performDownload pulls the selected model into the model directory through
 * the download route's hf CLI. On a successful pull it re-fetches both read
 * models (the summary and the deps panel) through repriceAll (the model
 * status row re-checks the directory and hides). A failed pull settles the
 * cell to error with the route's own detail.
 */
export declare function performDownload(store: CardStore, t: TextTable): Promise<void>;
//# sourceMappingURL=actions.d.ts.map
