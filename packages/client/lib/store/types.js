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
// idleActionState builds one idle action cell, the starting value every
// action and template cell reads before its first start.
function idleActionState() {
    return { status: 'idle', detail: '' };
}
/**
 * initialCardState builds the store's starting state: no summary, no draft,
 * idle action cells, and the ui defaults the card's first render reads
 * (help on, Auto Rebuild on, the form collapsed, the Logs pane at its
 * default height in fresh mode).
 */
export function initialCardState() {
    return {
        summary: null,
        summaryNote: '',
        draft: null,
        dirty: false,
        launch: {},
        actions: {
            save: idleActionState(),
            install: idleActionState(),
            register: idleActionState(),
            unregister: idleActionState(),
            launch: idleActionState(),
            stop: idleActionState(),
            get: idleActionState(),
            download: idleActionState(),
        },
        templateActions: { download: idleActionState() },
        deps: null,
        notes: { deps: '', copy: '' },
        ui: {
            help: true,
            autoRebuild: true,
            agentDefault: false,
            providerFormMode: 'collapsed',
            editingProviderId: null,
            deletingProviderId: null,
            cachedDraft: null,
            logPath: '',
            logs: { getLogs: null, height: 96, scrollMode: 'fresh' },
            getProgress: null,
            sudoPending: false,
        },
    };
}
//# sourceMappingURL=types.js.map
