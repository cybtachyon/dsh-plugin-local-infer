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
import type { EngineOsProfile } from './engines/engineOs.ts';
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
    windowsBuildSteps?: readonly string[];
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
 * image); Strata builds through its own setup.sh (the README's
 * Build-from-source route), which the source-build mode runs in the checkout.
 * The build steps are read from the per-engine OS profiles, so a build command
 * has one home (the OS-specific files under engines/).
 */
export declare const ENGINE_SOURCES: Record<string, EngineSource>;
/**
 * engineOsProfile reads the registered build profile for an engine id on an OS,
 * or undefined when none is registered. A host OS with no dedicated profile
 * (a Windows host for an engine that carries no Windows route) reads the
 * shared Linux profile.
 */
export declare function engineOsProfile(engineId: string, os?: 'linux' | 'windows' | 'macos'): EngineOsProfile | undefined;
/**
 * engineBuildDir reads the directory, relative to the checkout, where an
 * engine's build leaves its binary on an OS, so the binary symlink step reads
 * the right tree. A Windows host reads the engine's Windows build tree (the
 * vcpkg route for NInfer writes into build-windows\apps\Release); every other
 * host reads the shared Linux build directory. An engine that installs its
 * binary to the path (Strata) carries no build directory, so it reads as
 * `build`, the shared default.
 */
export declare function engineBuildDir(engineId: string, os?: 'linux' | 'windows' | 'macos'): string;
/**
 * engineBinary reads the engine binary name on an OS (the .exe on Windows), so
 * the adapters and the symlink step share one source. An engine with no local
 * binary (the compose engines) reads as undefined.
 */
export declare function engineBinary(engineId: string, os?: 'linux' | 'windows' | 'macos'): string | undefined;
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
 * engineBuildSteps reads the build steps an engine runs in its checkout for an
 * OS, so the adapter's deploy step and the Get build step share one list. The
 * steps come from the engine's OS profile: a Windows host reads the engine's
 * Windows profile (the vcpkg route for NInfer), and a host OS with no
 * dedicated profile reads the shared Linux profile.
 */
export declare function engineBuildSteps(engineId: string, os?: 'linux' | 'windows' | 'macos'): readonly string[];
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
 * SyncRebuildRequest names the checkout the conditional rebuild prices: the
 * engine, its directory, the optional fork remote, and the Play/Run trust gate
 * that decides whether the binary symlink (added when a rebuild leaves the
 * binary out of the path) runs (on) or is written to the logs (off). The
 * symlink step reads the bare binary name from the engine profile, so the
 * request carries no binary of its own.
 */
export interface SyncRebuildRequest {
    engineId: string;
    directory: string;
    fork?: string;
    allowRunDeps?: boolean;
    buildCommands?: string;
    onBuildStart?: () => void;
    os?: 'linux' | 'windows' | 'macos';
}
/**
 * SyncRebuildResult reports the conditional rebuild: whether it passed,
 * whether a build actually ran (a fresh clone, or a rebase of a checkout that
 * was behind), a detail for a failure, and the captured log text (the decision,
 * the build command, and its output) the deploy step threads to the card's
 * Logs section.
 */
export interface SyncRebuildResult {
    ok: boolean;
    rebuilt: boolean;
    detail?: string;
    logs: string;
}
/**
 * syncAndRebuildEngine brings the engine checkout to the listed source and
 * rebuilds it only when it needs to. A missing checkout is a fresh clone of
 * the fork (or the upstream repo) and always builds. An existing checkout is
 * fetched and priced against the remote branch: when it is behind and clean,
 * the primary branch is checked out, rebased onto the remote branch, and the
 * working tree is cleaned (git clean -fxd) before the build; when it is not
 * behind, or it carries local changes, the build is skipped so a launch does
 * not rebuild a checkout that is current. The decision, the build command,
 * and its output stream through log and are returned as the result's logs.
 * After a rebuild, the engine binary is checked against the path; when a build
 * that did not install it leaves it out, a symlink into /usr/local/bin is
 * added (run when the trust gate is on, written to the logs when it is off).
 */
export declare function syncAndRebuildEngine(host: LifecycleHost, request: SyncRebuildRequest, log: AcquireLog): Promise<SyncRebuildResult>;
/**
 * buildEngineRepo runs the engine's build steps in the checkout, streaming
 * each step's output through log. An engine with no build steps (the compose
 * engines) passes through with a note; a failing step stops the build with
 * the step's detail.
 */
export declare function buildEngineRepo(host: LifecycleHost, engineId: string, directory: string, log: AcquireLog, buildCommands?: string, os?: 'linux' | 'windows' | 'macos'): Promise<EngineStepResult>;
//# sourceMappingURL=acquire.d.ts.map