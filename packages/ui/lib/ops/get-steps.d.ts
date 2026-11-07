/**
 * The shared Get-steps routine both getEngine and launchEngine route through:
 * it runs, in order, (1) the engine's system-dependency install for the host
 * OS (gated by the Play/Run trust gate), (2) the git clone of the engine repo
 * (or the fork) plus the fetch/rebase of a clean checkout, (3) the source
 * build step (the compose engines carry no local build steps), (4) the hf
 * download of the selected model when it is not already present, and (5) the
 * hf download of any selected chat template when it is not already present.
 * Every step streams through the log sink as it lands, and an already-
 * satisfied step is skipped and logged as such, so a Launch that runs the
 * routine before the deploy is idempotent. With an `onStep` reporter (a
 * Launch's progress sink; a standalone Get passes none) each step announces
 * its launch phase only when its work actually starts, so the card's button
 * reads the phase that is running. A Launch can set
 * `continueOnSyncFailure` on the request: when the git sync (rebase) of an
 * existing checkout fails, the run keeps going with the checkout's current
 * version and reports `syncFailed` on the result, so a broken rebase never
 * halts the launch. A standalone Get omits the flag and keeps stopping on a
 * sync failure.
 * @module dsh-plugin-local-infer/ui/ops/get-steps
 */
import type { Config, LaunchProgress, LifecycleHost } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { StoredPlatformConfig } from '../config.ts';
/**
 * GetStepsRequest names the run: the engine, the config the dep plan, build
 * mode, model, and chat template read from, the platform entry the checkout
 * directory and fork resolve against, the Play/Run trust gate that decides
 * whether the dependency install runs, and the lifecycle host the git and
 * build steps run through. `autoRebuild` false (the card's Auto Rebuild
 * checkbox off) skips the sync and build steps, so a launch reads the
 * checkout as-is, the same rule the adapter's deploy step applies. `signal`
 * is the card's cancel: an abort interrupts the in-flight hf download child
 * (SIGINT, then SIGTERM), resume is within-invocation only (the hf CLI resumes a network blip via
 * HTTP Range inside one run); a killed run re-downloads from zero on the
 * re-run, and the orphaned `.incomplete` blob lingers until `hf cache prune`.
 * `onChunk` is the hf download's raw stderr progress sink: the download
 * runner hands each streamed stdout and stderr chunk to it as it lands,
 * separate from the log text sink the step lines stream through, so the
 * caller parses the tqdm lines into progress events. `onStep` is the launch
 * phase reporter (the card's button reader): a step announces its phase only
 * when its work actually starts (the dep install, the sync/build, a model or
 * template download), so a satisfied-and-skipped step announces nothing. A
 * standalone Get passes none (its control keeps its throbber); a Launch
 * threads its route progress sink here. `continueOnSyncFailure`
 * (a Launch-only flag) keeps the run going when the git sync of an existing
 * checkout fails: the run reports `syncFailed` on the result and the launch
 * continues with the checkout's current version, so a broken rebase never
 * halts it. A standalone Get omits it and stops on a sync failure.
 */
export interface GetStepsRequest {
    engineId: string;
    config: Config;
    platform?: StoredPlatformConfig;
    allowRunDeps: boolean;
    autoRebuild?: boolean;
    continueOnSyncFailure?: boolean;
    host: LifecycleHost;
    signal?: AbortSignal;
    onChunk?: (chunk: string) => void;
    onStep?: LaunchProgress;
}
/**
 * GetStepsResult reports the run: whether every step passed, a detail the
 * Logs section shows when one did not, and the captured log text (every step
 * line, in order) the caller persists or streams to the card. `syncFailed`
 * marks a run that kept going after a non-fatal git sync failure (the
 * `continueOnSyncFailure` override): `ok` stays true and the caller threads
 * the flag into the launch so the deploy skips its own git sync and launches
 * the checkout's current version.
 */
export interface GetStepsResult {
    ok: boolean;
    logs: string;
    detail?: string;
    syncFailed?: boolean;
}
/**
 * resolveEngineDirectory picks the checkout the Get step syncs: the Engine
 * Directory override when it names a path, else the engine's default
 * checkout home `~/.cache/dsh/infer/{engineId}` (one checkout per engine,
 * never a subfolder of a model directory), so a Get with no override still
 * has a real place to live.
 */
export declare function resolveEngineDirectory(engineId: string, platform: StoredPlatformConfig | undefined): string;
/**
 * runGetSteps is the shared Get-steps routine. It runs the five steps in
 * order, streaming each through log and collecting the same text as the
 * result's logs, so a caller can persist the run (a Get) or thread it into
 * the launch's persisted logs (a Launch) without re-running the steps. A
 * step that is already satisfied is skipped and logged as such; a failing
 * step stops the run and names the broken step in the detail. A step that
 * fails non-fatally (the git sync under the `continueOnSyncFailure`
 * override) keeps the run going and threads `syncFailed` into the result, so
 * the launch continues with the checkout's current version.
 */
export declare function runGetSteps(localInfer: LocalInferService, request: GetStepsRequest, log: (chunk: string) => void): Promise<GetStepsResult>;
//# sourceMappingURL=get-steps.d.ts.map
