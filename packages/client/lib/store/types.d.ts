/**
 * The card store's state schema: CardState (the single source of truth the
 * card renders from), the ActionState / ActionKey lifecycle cells every
 * server round trip runs through, and the CardAction union the reducer
 * consumes.
 *
 * The schema encodes the two desync fixes the refactor exists for. First,
 * the draft is the only source for form field values: summary (the last
 * server ack) is a read model the card never renders as a form value, and a
 * summary ack merges its persisted fields into the draft field-level
 * (platform entries merge per-engine, preserving local edits). Second, the
 * per-provider launch machine is the only source for lifecycle state: the
 * title-bar control and the provider entries' Launch buttons both read it
 * through one derivation, so the mirrored "is the engine running" copies the
 * hand-written card kept in separate state variables have no home here.
 * @module dsh-plugin-local-infer/client/store/types
 */
import type { Config, DepsModel, LocalInferSummary, StoredPlatformConfig } from 'dsh-plugin-local-infer/ui';
import type { LaunchEntry, LaunchEvent } from '../machine/launch.ts';
/**
 * LaunchStoreEntry is the store's per-provider launch machine entry: the
 * machine's LaunchEntry (status + cause) plus the startTime the deadline
 * timers price. The machine stays pure (no clock read), so the reducer stamps
 * startTime on every launch/move; the stop-poll and the launch health-poll
 * arm off it.
 */
export interface LaunchStoreEntry extends LaunchEntry {
    startTime: number;
}
/**
 * CardDraft is the card's local edit of one engine's config: the engine id,
 * the form field values, and the unsaved per-engine platform edits (the
 * Engine Directory and Engine Fork fields) a Save persists. The draft is
 * the only source for form field values; a field edit updates it, sets
 * dirty, and schedules the debounced re-price, and a summary ack merges its
 * persisted fields back into it without clobbering the local edits.
 */
export interface CardDraft {
    engine: string;
    config: Config;
    platform?: Record<string, StoredPlatformConfig>;
}
/**
 * ActionKey names a card server mutation, each of which runs through
 * performAction as a pending -> ack | timeout transition. The keys mirror
 * the /local-infer/* POST routes: save upserts a provider entry, install
 * runs the Play/Run path, register and unregister manage the DSH model row,
 * launch and stop drive the engine lifecycle, get streams the build, and
 * download pulls the selected model.
 */
export type ActionKey = 'save' | 'install' | 'register' | 'unregister' | 'launch' | 'stop' | 'get' | 'download';
/** TemplateActionKey names the chat-template auto-download action. */
export type TemplateActionKey = 'download';
/**
 * ActionState is one action's lifecycle cell: idle before the first start,
 * pending while the round trip is in flight, ok or error when it settles,
 * and detail the message the control renders (a success note, the host's
 * own error, or the timeout). A late ack after the timeout is a no-op: the
 * reducer settles an action only while it is still pending.
 */
export interface ActionState {
    status: 'idle' | 'pending' | 'ok' | 'error';
    detail: string;
}
/**
 * NoteKey names a card note that is not an action's detail: the deps read
 * (a re-price, not a mutation, so it carries no action cell) and the
 * clipboard copy (client-side only). Action notes ride the owning action's
 * ActionState.detail, so the register, lifecycle, and download notes the
 * hand-written card kept as separate state have no note key here.
 */
export type NoteKey = 'deps' | 'copy';
/** CardNotes holds the card's free-form notes, one per NoteKey. */
export interface CardNotes {
    deps: string;
    copy: string;
}
/**
 * ProviderFormMode is the provider form's mode: collapsed (the entry list
 * shows), editing (an existing entry's form is open), and new (a minted
 * entry's form is open). With no stored entries the card forces 'new' at
 * render, because the form is where the first provider is entered.
 */
export type ProviderFormMode = 'collapsed' | 'editing' | 'new';
/**
 * LogsScrollMode is the Logs pane's auto-scroll mode: fresh (the pane just
 * opened, the first render pins the view to the bottom), scrolling (content
 * updates keep pinning the bottom), and manual (the user scrolled up, so
 * updates leave the view where they put it).
 */
export type LogsScrollMode = 'fresh' | 'scrolling' | 'manual';
/**
 * LogsPaneState is the Logs pane state: the streamed Get output buffer (null
 * while no run is in flight, so the pane shows the summary's lastLogs
 * instead), the chevron-resized height, and the auto-scroll mode.
 */
export interface LogsPaneState {
    getLogs: string | null;
    height: number;
    scrollMode: LogsScrollMode;
}
/**
 * CardUiState is the UI-local state the card keeps and never syncs: the
 * help, Auto Rebuild, and agent-default toggles, the provider form mode and
 * its editing context, the log-location field, and the Logs pane. None of
 * it crosses a server round trip; the save route persists showHelp and
 * logPath as stored preferences, not as ui state.
 */
export interface CardUiState {
    help: boolean;
    autoRebuild: boolean;
    agentDefault: boolean;
    providerFormMode: ProviderFormMode;
    editingProviderId: string | null;
    deletingProviderId: string | null;
    cachedDraft: CardDraft | null;
    logPath: string;
    logs: LogsPaneState;
}
/**
 * CardState is the card's single source of truth. summary is the last
 * server ack (the read model); draft is the only source for form field
 * values; launch is the per-provider machine the lifecycle controls read
 * (keyed by provider id, driven only by launch/move); actions and
 * templateActions are the pending -> ack | timeout cells for every server
 * round trip; notes and ui are the card-local state that never syncs.
 */
export interface CardState {
    summary: LocalInferSummary | null;
    summaryNote: string;
    draft: CardDraft | null;
    dirty: boolean;
    launch: Record<string, LaunchStoreEntry>;
    actions: Record<ActionKey, ActionState>;
    templateActions: Record<TemplateActionKey, ActionState>;
    deps: DepsModel | null;
    notes: CardNotes;
    ui: CardUiState;
}
/**
 * CardAction is the reducer action union. Every server mutation is an
 * action/start followed by a settling action/ack, action/fail, or
 * action/timeout, and the template download runs the same cycle under the
 * template/* types. Reads (the summary and deps re-price) and the local
 * draft and ui updates ride the same union, so the reducer is the only
 * mutator of CardState. draft/edit marks a typed field dirty; draft/load
 * stores a named draft (a stored provider, the cached values) without
 * marking it dirty; draft/discard reverts to the summary.
 */
export type CardAction = {
    type: 'summary/ack';
    summary: LocalInferSummary;
} | {
    type: 'summary/fail';
    note: string;
} | {
    type: 'deps/ack';
    deps: DepsModel;
} | {
    type: 'deps/fail';
    note: string;
} | {
    type: 'deps/clear';
} | {
    type: 'draft/edit';
    draft: CardDraft;
} | {
    type: 'draft/load';
    draft: CardDraft;
} | {
    type: 'draft/discard';
} | {
    type: 'action/start';
    key: ActionKey;
} | {
    type: 'action/ack';
    key: ActionKey;
    detail: string;
} | {
    type: 'action/fail';
    key: ActionKey;
    detail: string;
} | {
    type: 'action/timeout';
    key: ActionKey;
} | {
    type: 'template/start';
} | {
    type: 'template/ack';
    detail: string;
} | {
    type: 'template/fail';
    detail: string;
} | {
    type: 'template/timeout';
} | {
    type: 'launch/move';
    providerId: string;
    event: LaunchEvent;
} | {
    type: 'note/set';
    key: NoteKey;
    note: string;
} | {
    type: 'note/clear';
    key: NoteKey;
} | {
    type: 'ui/patch';
    patch: Partial<CardUiState>;
};
/**
 * initialCardState builds the store's starting state: no summary, no draft,
 * idle action cells, and the ui defaults the card's first render reads
 * (help on, Auto Rebuild on, the form collapsed, the Logs pane at its
 * default height in fresh mode).
 */
export declare function initialCardState(): CardState;
//# sourceMappingURL=types.d.ts.map
