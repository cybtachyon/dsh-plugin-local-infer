/**
 * The chat-template download driver: downloadTemplate pulls the selected
 * template (the summary's chatTemplateStatus repo) into the model directory
 * through the /local-infer/chat-template route, running the round trip as a
 * pending -> ack | timeout transition over the store's template cell.
 *
 * The driver reads the draft for the engine and the model directory, and
 * guards the round trip: no draft, an empty repo, and a download already in
 * flight all read as no-ops. The cell's pending guard is the double-fire
 * protection the hand-written card kept in a requested-repos ref, and a
 * failed download settles the cell to error, so a later retry (the
 * button, or a re-select) can start again.
 * @module dsh-plugin-local-infer/client/store/template
 */
import { type CardStore } from './sync.ts';
/**
 * downloadTemplate pulls the named template repo into the model directory.
 * It no-ops while the draft is absent, the repo is empty, or a download is
 * already in flight. The ack detail stays neutral ('ok'): the component
 * maps the cell to the localized note, the way the action cells map
 * ACTION_TIMEOUT_DETAIL.
 */
export declare function downloadTemplate(store: CardStore, repo: string): Promise<void>;
//# sourceMappingURL=template.d.ts.map
