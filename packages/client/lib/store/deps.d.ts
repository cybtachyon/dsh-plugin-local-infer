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
 * GET_IDLE_MS is the Get run's output-idle cap in ms and the get cell's
 * only deadline (performAction arms no fixed timer for get, the
 * NO_FIXED_DEADLINE rule in sync.ts). Two minutes without a streamed line
 * reads as a stalled build: the card settles the get cell (the control
 * re-enables) while the run keeps streaming in the background. Each
 * progress event re-arms it, so an actively streaming run holds the cell
 * pending for as long as it runs.
 */
export declare const GET_IDLE_MS = 120000;
/**
 * GET_PROGRESS_THROTTLE_MS is the minimum interval in ms between
 * getProgress store patches: the card folds the streamed tqdm state at
 * ~2 Hz. The latest state always lands on the final chunk and when the run
 * settles (the throttle's pending flush).
 */
export declare const GET_PROGRESS_THROTTLE_MS = 500;
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
 * repriceAll re-fetches both read models the card prices from the host's
 * stored config: the summary (the meter, the provider list, the status dots)
 * and the deps panel. The pair always re-prices together with the same query,
 * so the drivers call this one helper instead of the two fetches. The fetches
 * are fire-and-forget (the drivers do not await them), so the returned
 * promise settles immediately.
 */
export declare function repriceAll(store: CardStore, query?: PriceQuery): Promise<void>;
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
 * route's own message, which the panel renders as the deps note. The install
 * brackets one run-log stream (the host keys it on the request's engine and
 * config, per the mirrored runLogKey rule), detached when the round trip
 * settles.
 */
export declare function performInstall(store: CardStore, t: TextTable): Promise<void>;
/**
 * performGet runs the git sync, the dependency plan, and the build through
 * the get route's NDJSON stream. The route's answer carries progress events
 * only (its log events are gone): the run's live text reaches the Logs buffer
 * through the one attached run-log stream under the key the host's get route
 * writes (no providerId, the draft's engine and config, per the mirrored
 * runLogKey rule), whose runBegin lands the host's "Getting engine and
 * model..." seed, so no line lands twice. Each progress event re-arms the
 * idle cap: two minutes without a line settles the get cell (the control
 * re-enables) while the run keeps streaming in the background. The run folds
 * the structured progress state into the ui.getProgress readout through the
 * ProgressThrottle (the 500 ms cadence), and the field clears when the run
 * settles (success, failure, or abort), so the readout never outlives the
 * run. When the stream ends, the route has
 * persisted the run as the last logs, so a re-read of both read models (the
 * summary and the deps panel) hands the Logs section back to the stored
 * value. The run registers its AbortController in the in-flight
 * registry, so the provider form's Cancel closes the stream and the route
 * interrupts the in-flight hf child; an aborted run settles without a
 * failure line (the "Canceled" line the Cancel wrote is the run's tail). A
 * second click while a run is in flight (a long download that outlived the
 * idle cap and settled the cell) is a no-op, so it never starts a concurrent
 * run: the in-flight download keeps streaming, and a restart needs a Cancel
 * first.
 */
export declare function performGet(store: CardStore, t: TextTable): Promise<void>;
/**
 * performGetCancel cancels the in-flight Get run without collapsing the
 * provider form. It aborts the tracked run through cancelInFlightRuns (the
 * service's downloadRunner watchChildAbort then sends SIGINT to the hf
 * child, escalating to SIGTERM after the grace window), appends the
 * "Canceled" line to the Logs buffer when a run was aborted, and clears the
 * getProgress readout back to null. The form stays open (the draft and the
 * form mode are untouched, unlike cancelProvider). The aborted run settles
 * the get cell to error through performGet's settle path, so the 'getting'
 * control branch and the step chips stop firing. The cancel affordances
 * (the title bar, the deps panel, and the Logs header) call it.
 */
export declare function performGetCancel(store: CardStore): void;
//# sourceMappingURL=deps.d.ts.map
