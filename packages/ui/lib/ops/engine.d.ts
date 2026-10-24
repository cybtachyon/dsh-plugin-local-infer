/**
 * The engine lifecycle operations: launchEngine renders the plan the
 * registered adapter produces and runs the service's launch entry point
 * (deploy, then the health poll); stopEngine stops the exact container or
 * process the launch started; getEngine runs the Get step (git sync, dep
 * plan, build, model artifacts). The launch record (the engine pid, start
 * time, launch arguments, and the DSH process pid that launched it) is what
 * a DSH restart re-links a surviving engine to its config:
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
 * resolveAdapter picks the registered engine adapter an engine id routes to. A
 * card that names an engine no adapter serves gets a 404, not a blank panel.
 */
export declare function resolveAdapter(localInfer: LocalInferService, engineId: string): import("dsh-plugin-local-infer/core").EngineAdapter;
/**
 * launchEngine renders the plan the registered adapter produces for the config
 * and the detected hardware, then runs the service's launch entry point
 * (deploy, then the health poll). The detail the launch returns names the
 * broken step when the engine does not come up. The launch line (the engine
 * binary and its arguments) leads the run logs the card's Logs section and
 * the log file carry, so a broken setup diagnoses against the exact child
 * process the launch started. The launch step persists the
 * launch record (the engine pid, start time, launch arguments, and the DSH
 * process pid that launched it) on the request's provider entry, so a DSH
 * restart can re-link a surviving engine to its config.
 */
export declare function launchEngine(localInfer: LocalInferService, request: LaunchRequest, onProgress?: (step: LaunchStep) => void): Promise<LaunchResult>;
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
 * writes it to the configured log file. The log file is only written when the
 * run produced output and the log location is set; the last-run logs are always
 * persisted (an empty string clears a stale run) so the card's Logs section
 * shows the previous run after a reload.
 */
export declare function persistLaunchLogs(result: LaunchResult, engineId: string, config: Config): void;
/**
 * stopEngine renders the same plan and runs the service's stop entry point, so
 * the stop step targets the exact container or process the launch started. The
 * stop then clears the target entry's launch record (the engine pid and the
 * previous-pid list with it), so a recycled pid cannot re-link an engine the
 * user just stopped.
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
 * getEngine is the Get step: it syncs the engine checkout (clone the git
 * repo, or the fork when the platform entry provides one; fetch and rebase
 * a clean checkout; abort with a Logs alert when the checkout has local
 * changes), runs the system dependency plan, and runs the engine's build
 * steps. Every command and its output streams through log as it lands, so
 * the card appends it to the Logs section live. The dependency install only
 * runs while the Play/Run trust gate is on; with the gate off the deps are
 * re-checked and a missing one aborts the step with the copy/paste note.
 */
export declare function getEngine(localInfer: LocalInferService, request: GetRequest, log: (chunk: string) => void, host?: LifecycleHost): Promise<GetOutcome>;
/**
 * syncPlatformConfigs re-syncs the service registry with the stored platform
 * map: it registers (or re-registers) every engine that carries a config, and
 * unregisters every engine that no longer does, so a launch always reads the
 * platform config the user last saved.
 */
export declare function syncPlatformConfigs(localInfer: LocalInferService, stored: StoredConfig): void;
//# sourceMappingURL=engine.d.ts.map