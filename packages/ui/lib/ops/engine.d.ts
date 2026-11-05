/**
 * The engine lifecycle operations: launchEngine runs the shared Get-steps
 * routine (idempotent) and then renders the plan the registered adapter
 * produces and runs the service's launch entry point (deploy, then the health
 * poll), preserving the Get-step logs in the persisted last-run logs;
 * stopEngine stops the exact container or process the launch started (a
 * re-adopted engine through the record's pid), and a failed stop persists a
 * note to the last-run logs and the log file; getEngine is a thin wrapper
 * over the shared Get-steps routine (deps, git sync, build, model download,
 * chat-template download). The launch record (the engine pid, start time,
 * launch arguments, and the DSH process pid that launched it) is what a DSH
 * restart re-links a surviving engine to its config:
 * relinkStoredProviders re-adopts surviving engines on mount and per summary
 * read, handleEngineDeath settles the stored state the moment an engine dies
 * outside the stop path, and persistLaunchLogs stores the captured output.
 * The platform-config registry sync keeps the service registry in step with
 * the stored config.
 * @module dsh-plugin-local-infer/ui/ops/engine
 */
import type { Config, LaunchStep, LifecycleHost } from 'dsh-plugin-local-infer/core';
import type { EngineDeathEvent, LaunchResult, LocalInferService } from 'dsh-plugin-local-infer/service';
import type { StoredConfig, StoredProviderConfig } from '../config.ts';
import type { GetRequest, LaunchRequest } from '../request.ts';
/**
 * CANCELED_LINE is the "Canceled" line a client-disconnect cancel appends to
 * the persisted run, so the Logs section and the log file read the run as
 * canceled, the same line the card writes to its Logs buffer on the Cancel.
 */
export declare const CANCELED_LINE = "--- Canceled\n";
/**
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
export declare function resolveAdapter(localInfer: LocalInferService, engineId: string): import("dsh-plugin-local-infer/core").EngineAdapter;
/**
 * launchEngine runs the shared Get-steps routine (idempotent: deps, git sync,
 * build, model download, chat-template download, each skipped when already
 * satisfied) and then renders the plan the registered adapter produces for
 * the config and the detected hardware, and runs the service's launch entry
 * point (deploy, then the health poll). A git sync of an existing checkout
 * that fails under the continueOnSyncFailure override (always on for a
 * launch) keeps the Get run going with the checkout's current version and
 * reports syncFailed on the result; the launch then threads autoRebuild:
 * false into the deploy step, which skips its own git sync (it would hit the
 * same rebase conflict) and launches the current version, while the Get
 * error line persists in the last-run logs and the log file. The detail the
 * launch returns names the broken step when the engine does not come up.
 * The launch line (the
 * engine binary and its arguments) leads the engine output in the run logs
 * the card's Logs section and the log file carry, and the Get-step output the
 * launch ran leads it, so a broken setup diagnoses against the exact steps
 * and child process the launch started, and the Get logs are preserved, not
 * wiped, by the launch's persistence. The launch step persists the
 * launch record (the engine pid, start time, launch arguments, and the DSH
 * process pid that launched it) on the request's provider entry, so a DSH
 * restart can re-link a surviving engine to its config. The optional signal
 * is the card's cancel: an abort interrupts the in-flight Get-step download
 * child, and the persisted run carries a "Canceled" line. The optional
 * onChunk is the hf download's raw stderr progress sink: the download runner
 * hands each streamed chunk to it as it lands, so a launch that runs the Get
 * steps streams the download progress the same way a Get does. The optional
 * onSudo is the route's sudo-event writer: while the run is in flight, the
 * service's sudo observer answers a guarded command waiting for a password on
 * the launching CLI by landing the core CLI note in the run logs and the log
 * file and calling onSudo; the observer is unregistered when the run settles,
 * failed or not, so a failing run leaves none behind.
 */
export declare function launchEngine(localInfer: LocalInferService, request: LaunchRequest, onProgress?: (step: LaunchStep) => void, host?: LifecycleHost, signal?: AbortSignal, onChunk?: (chunk: string) => void, onSudo?: () => void): Promise<LaunchResult>;
/**
 * handleEngineDeath persists a provider entry's state when its engine process
 * dies outside the plugin's stop path: a crash, a pkill of a plugin-launched
 * child seen through the service's exit watch, or the poll-detected exit of a
 * process adopted after a DSH restart. The entry whose launch record names the
 * dead pid (or the dead engine-and-port, when the report carries no pid match)
 * has its record cleared, so a restart never re-links a dead pid, and the exit
 * line lands in the card's last-run logs beside the engine's own output. An
 * event that matches no entry carrying a record (a stop the route already
 * cleared, an engine the plugin never tracked) is a no-op, which keeps an
 * expected stop quiet.
 */
export declare function handleEngineDeath(event: EngineDeathEvent): void;
/**
 * persistLaunchLogs stores a launch's captured output as the last run and
 * writes it to the configured log file. The Get-step output the launch ran
 * (the optional getLogs) leads the persisted run, so the Logs section and the
 * log file show the Get steps followed by the launch, not the launch wiping
 * the Get logs. The log file is only written when the run produced output and
 * the log location is set; the last-run logs are always persisted (an empty
 * string clears a stale run) so the card's Logs section shows the previous
 * run after a reload.
 */
export declare function persistLaunchLogs(result: LaunchResult, engineId: string, config: Config, getLogs?: string): void;
/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started. The
 * stop then clears the target entry's launch record (the engine pid and the
 * previous-pid list with it), so a recycled pid cannot re-link an engine the
 * user just stopped. An engine a DSH restart re-adopted carries no tracked
 * child handle in the adapter, so the stop stamps the record's pid on the
 * plan and the adapter signals it through the host; a stop that fails
 * persists a note (the engine, the model, and the host's message) to the
 * stored last-run logs and the log file, so the card's Logs section names the
 * broken step, and re-throws, so the route answers 500 and the card's stop
 * deadline settles the entry to the red Logs state.
 */
export declare function stopEngine(localInfer: LocalInferService, request: LaunchRequest): Promise<void>;
/**
 * relinkStoredProviders prices every stored provider launch record against the
 * live process table through the service's re-link rule and returns the
 * provider list the card should read: an adopted engine is re-marked plugin-
 * launched and tied to its model by the service, and a liveness watcher starts
 * on its port so a later pkill settles the stored state through the death
 * observer without another summary read; a dead engine's record is cleared on
 * disk here (the previous-pid list with it), so a recycled pid cannot re-link
 * to a config whose engine is down. The route calls it on mount and the
 * summary calls it per read, making re-attach independent of the card opening.
 */
export declare function relinkStoredProviders(localInfer: LocalInferService, stored: StoredConfig): Promise<StoredProviderConfig[]>;
/**
 * GetOutcome is the answer the Get step reports: ok with no detail, or a
 * failure naming the broken step. The object literal union keeps the
 * invariant the card reads: a detail only exists on a failure.
 */
export type GetOutcome = {
    ok: true;
} | {
    ok: false;
    detail?: string;
};
/**
 * getEngine is the Get step: a thin wrapper over the shared Get-steps routine
 * (the system dependencies, the git sync, the build, the model download, and
 * the chat-template download), streaming every step through log as it lands,
 * so the card appends it to the Logs section live. The dependency install
 * only runs while the Play/Run trust gate is on; with the gate off the deps
 * are re-checked and a missing one aborts the step with the copy/paste note.
 * The optional signal is the card's cancel: an abort interrupts the in-flight
 * hf download child (SIGINT, then SIGTERM). Resume is within-invocation only:
 * the hf CLI (huggingface_hub 2.x) resumes a network blip via HTTP Range inside
 * one `hf download` run, but a killed run re-downloads from zero on the re-run
 * (each run writes a process-unique `.incomplete` temp blob and unlinks it on
 * failure), so an orphaned partial blob lingers until `hf cache prune`. The
 * optional onChunk is the hf download's raw stderr progress sink: the
 * download runner hands each streamed chunk to it as it lands, separate from
 * the log sink, so the route parses the tqdm lines into progress events.
 */
export declare function getEngine(localInfer: LocalInferService, request: GetRequest, log: (chunk: string) => void, host?: LifecycleHost, signal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<GetOutcome>;
/**
 * syncPlatformConfigs re-syncs the service registry with the stored platform
 * map: it registers (or re-registers) every engine that carries a config, and
 * unregisters every engine that no longer does, so a launch always reads the
 * platform config the user last saved.
 */
export declare function syncPlatformConfigs(localInfer: LocalInferService, stored: StoredConfig): void;
//# sourceMappingURL=engine.d.ts.map
