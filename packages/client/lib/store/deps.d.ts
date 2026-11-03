/**
 * The deps panel drivers: the copy, allow-run, install, and Get actions the
 * System dependencies panel runs, plus the deps re-price read.
 *
 * Every server mutation rides performAction as a pending -> ack | timeout
 * transition over the store's action cells, the way the template download
 * rides the template cell. The deps re-price is a read (the route re-probes
 * the host on every fetch, so the "Get" gate always reads the live checkDeps
 * answer), so it carries no action cell: it settles the deps model and the
 * deps note. The clipboard copy is client-side only, so it rides the copy
 * note.
 * @module dsh-plugin-local-infer/client/store/deps
 */
import { type PriceQuery } from '../api/routes.ts';
import type { TextTable } from '../text.ts';
import { type CardStore } from './sync.ts';
/**
 * GET_IDLE_MS is the Get run's output-idle cap in ms. Two minutes without a
 * streamed line reads as a stalled build: the card settles the get cell (the
 * control re-enables) while the run keeps streaming in the background.
 */
export declare const GET_IDLE_MS = 120000;
/**
 * repriceDeps re-fetches the deps panel model (the GET /local-infer/deps
 * route). A fetch failure reads as no panel: a host that predates the deps
 * route keeps the card usable, so the model clears and the panel hides.
 */
export declare function repriceDeps(store: CardStore, query?: PriceQuery): Promise<void>;
/**
 * repriceSummary re-fetches the card's read model (the GET
 * /local-infer/summary route). The ack stores the summary and merges its
 * persisted fields into the draft field-level (the reducer's rule), so a
 * provider edit, cancel, or new-provider load re-prices the meter and the
 * provider list from the host's stored config. A fetch failure stores the
 * route's message as the summary note, so the card's load line names it.
 */
export declare function repriceSummary(store: CardStore, query?: PriceQuery): Promise<void>;
/**
 * copyInstallString hands the install block to the clipboard (client-side
 * only, so it rides the copy note, not an action cell). The note shows the
 * localized copied / copy-failed label for two seconds, then clears. A host
 * without a clipboard (or a write failure) reads as the copy-failed label.
 */
export declare function copyInstallString(store: CardStore, t: TextTable): void;
/**
 * performAllowRun persists the trust gate through the save route as a
 * settings-only save: the flag keeps the route from upserting a provider
 * entry, so a toggle never mints a duplicate at the top of the list. On the
 * ack it stores the fresh summary and re-prices the deps panel from the
 * persisted config. A failed or timed-out save leaves the stored config
 * untouched, so it re-prices nothing.
 */
export declare function performAllowRun(store: CardStore, checked: boolean): Promise<void>;
/**
 * performInstall runs the Play/Run path through the install route. The
 * response carries the re-checked deps model, so the panel re-renders the
 * gate from the same re-check the install ran: a passed re-check reads as
 * the satisfied note, a failed one names the unsatisfied deps. A route
 * refusal (the trust gate off) settles the install cell to error with the
 * route's own message, which the panel renders as the deps note.
 */
export declare function performInstall(store: CardStore, t: TextTable): Promise<void>;
/**
 * performGet runs the git sync, the dependency plan, and the build through
 * the get route's text stream. The click seeds the Logs section's streamed
 * buffer from the persisted last-run logs with a "Getting..." separator, so
 * the run reads as a fresh Logs section. Each chunk appends to the buffer
 * and re-arms the idle cap: two minutes without a line settles the get cell
 * (the control re-enables) while the run keeps streaming in the background.
 * When the stream ends, the route has persisted the run as the last logs,
 * so a summary re-read hands the Logs section back to the stored value.
 */
export declare function performGet(store: CardStore, t: TextTable): Promise<void>;
//# sourceMappingURL=deps.d.ts.map
