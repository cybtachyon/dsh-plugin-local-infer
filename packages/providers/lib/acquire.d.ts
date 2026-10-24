/**
 * The per-engine acquisition data and the Get step. Each engine declares its
 * git source (the upstream repo, the branch the rebase targets, and the build
 * steps the checkout runs) as data here; the adapters' deploy steps and the
 * /local-infer/get route both consume the same constants, so a build command
 * has one home. The sync step clones a missing checkout, and a clean existing
 * checkout is fetched and rebased onto the upstream branch; a checkout with
 * local changes aborts, because a rebase would eat the user's work.
 * @module dsh-plugin-local-infer/providers/acquire
 */
import type { LifecycleHost } from '../../core/lib/index.js';
/**
 * EngineSource is the per-engine acquisition data: the upstream git repo the
 * clone step uses when no fork is provided, the branch the fetch/rebase step
 * rebases onto, and the build steps run in the checkout after a clone or a
 * rebase. A build step is a shell command line; the `{dir}` placeholder is
 * replaced with the checkout directory before the step runs.
 */
export interface EngineSource {
    repo: string;
    branch: string;
    buildSteps: readonly string[];
}
/**
 * The remote name a user-provided fork is added under, so the checkout's own
 * origin (the upstream it was cloned from) survives the fork override.
 */
export declare const FORK_REMOTE = "dsh-fork";
/**
 * The per-engine git sources, keyed by engine id. NInfer and Infernix build
 * through cmake (Infernix through its own preset); llama.cpp builds through
 * the same cmake shape as NInfer; Hyper-Qwen is the compose-driven vLLM
 * engine, so it carries no local build steps (the compose up pulls the
 * image); Strata is the placeholder engine, and its repo and pull step land
 * with the engine, the same way its docker image constant did.
 */
export declare const ENGINE_SOURCES: Record<string, EngineSource>;
/**
 * AcquireLog receives one line (or chunk) of Get output as it lands, so the
 * route can stream it to the card's Logs section.
 */
export type AcquireLog = (chunk: string) => void;
/**
 * EngineStepResult reports one Get step (sync or build): whether it passed,
 * whether it aborted on a rule (a dirty checkout), and a detail the Logs
 * section shows when it did not pass.
 */
export interface EngineStepResult {
    ok: boolean;
    aborted?: boolean;
    detail?: string;
}
/**
 * engineSource reads the registered acquisition data for an engine id, or
 * undefined when none is registered.
 */
export declare function engineSource(engineId: string): EngineSource | undefined;
/**
 * engineBuildSteps reads the build steps an engine runs in its checkout, so
 * the adapter's deploy step and the Get build step share one list.
 */
export declare function engineBuildSteps(engineId: string): readonly string[];
/**
 * syncEngineRepo brings the engine checkout to the listed source. A missing
 * checkout is a fresh clone of the fork (or the engine's upstream repo when
 * no fork is provided). An existing checkout with local changes aborts, so
 * the user's work is never rebased away; a clean checkout fetches the listed
 * fork (added as the named fork remote when provided, origin when not) and
 * rebases onto its branch. Every command echoes into log as it runs.
 */
export declare function syncEngineRepo(host: LifecycleHost, request: {
    engineId: string;
    directory: string;
    fork?: string;
}, log: AcquireLog): Promise<EngineStepResult>;
/**
 * buildEngineRepo runs the engine's build steps in the checkout, streaming
 * each step's output through log. An engine with no build steps (the compose
 * engines) passes through with a note; a failing step stops the build with
 * the step's detail.
 */
export declare function buildEngineRepo(host: LifecycleHost, engineId: string, directory: string, log: AcquireLog): Promise<EngineStepResult>;
//# sourceMappingURL=acquire.d.ts.map