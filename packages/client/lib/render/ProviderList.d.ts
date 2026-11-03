/**
 * The provider list: the saved provider entries the summary carries, each a
 * collapsed card with a status dot (green running, red stopped, yellow
 * unsure), an "Engine: Model" title, and Edit / Delete / Launch controls. The
 * "New provider" control sits after the list: a clickable button while a new
 * provider can be started, plain text while the form is already in new mode.
 *
 * The list is a pure draw of the store: the provider rows read the summary's
 * entries, the per-entry Launch button reads the entry's launch machine
 * (state.launch[provider.id]), and the edit / cancel / new / delete / launch /
 * stop / Logs controls ride the store/providers.ts drivers. Each row owns its
 * entry's timer handle and cancels it on unmount, so a settled or abandoned
 * launch or stop never keeps re-fetching the summary.
 * @module dsh-plugin-local-infer/client/render/ProviderList
 */
import type { ReactNode } from 'react';
import type { LocalInferSummary, ProviderSummaryEntry } from 'dsh-plugin-local-infer/ui';
import type { TextTable } from '../text.ts';
import { type EntryTimerHandle } from '../store/providers.ts';
import type { CardStore } from '../store/sync.ts';
export interface ProviderListProps {
    store: CardStore;
    t: TextTable;
}
/**
 * ProviderList renders the saved provider entries: each a collapsed card with
 * a status dot, an "Engine: Model" title, and Edit / Delete / Launch
 * controls. The list renders nothing while there are no entries (the form
 * below, forced into new mode, is the entry point). The "New provider"
 * control sits after the rows.
 */
export declare function ProviderList(props: ProviderListProps): ReactNode;
export declare function NewProviderControl(props: {
    store: CardStore;
    t: TextTable;
}): ReactNode;
export interface ProviderRowProps {
    store: CardStore;
    provider: ProviderSummaryEntry;
    t: TextTable;
    engines: LocalInferSummary['engines'];
    editingId: string | null;
    deletingId: string | null;
}
export declare function ProviderRow(props: ProviderRowProps): ReactNode;
export interface EntryLaunchButtonProps {
    store: CardStore;
    provider: ProviderSummaryEntry;
    t: TextTable;
    handleRef: {
        current: EntryTimerHandle | null;
    };
}
export declare function EntryLaunchButton(props: EntryLaunchButtonProps): ReactNode;
//# sourceMappingURL=ProviderList.d.ts.map
