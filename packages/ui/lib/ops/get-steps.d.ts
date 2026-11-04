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
 * routine before the deploy is idempotent.
 * @module dsh-plugin-local-infer/ui/ops/get-steps
 */
import type { Config, LifecycleHost } from 'dsh-plugin-local-infer/core';
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
 * (SIGINT, then SIGTERM), and the hub-cache `.incomplete` blob resumes on
 * the re-run.
 */
export interface GetStepsRequest {
    engineId: string;
    config: Config;
    platform?: StoredPlatformConfig;
    allowRunDeps: boolean;
    autoRebuild?: boolean;
    host: LifecycleHost;
    signal?: AbortSignal;
}
/**
 * GetStepsResult reports the run: whether every step passed, a detail the
 * Logs section shows when one did not, and the captured log text (every step
 * line, in order) the caller persists or streams to the card.
 */
export interface GetStepsResult {
    ok: boolean;
    logs: string;
    detail?: string;
}
/**
 * resolveEngineDirectory picks the checkout the Get step syncs: the Engine
 * Directory override when it names a path, else a per-engine folder inside
 * the model directory (the default model directory, or the config's
 * override), so a Get with no override still has a real place to live.
 */
export declare function resolveEngineDirectory(localInfer: LocalInferService, config: Config, engineId: string, platform: StoredPlatformConfig | undefined): string;
/**
 * runGetSteps is the shared Get-steps routine. It runs the five steps in
 * order, streaming each through log and collecting the same text as the
 * result's logs, so a caller can persist the run (a Get) or thread it into
 * the launch's persisted logs (a Launch) without re-running the steps. A
 * step that is already satisfied is skipped and logged as such; a failing
 * step stops the run and names the broken step in the detail.
 */
export declare function runGetSteps(localInfer: LocalInferService, request: GetStepsRequest, log: (chunk: string) => void): Promise<GetStepsResult>;
//# sourceMappingURL=get-steps.d.ts.map
