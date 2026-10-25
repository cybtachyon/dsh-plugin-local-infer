/**
 * The shared engine-adapter helpers: the spec-to-argv and spec-to-env
 * translators the concrete adapters (the `engines/*Adapter.ts` files) compose
 * into a `LaunchPlan`, the card's Custom Arguments translators, the
 * `LifecycleHost` the deploy, health-check, and stop steps drive, and the
 * health poll. The node implementation (`nodeLifecycleHost`) is what the
 * service wires in on a live host.
 * @module dsh-plugin-local-infer/providers/adapters
 */
import type { Config, DebugLogger, HealthCheckOptions, HealthResult, LaunchPlan, LifecycleHost, ParameterSpec, ProcessHandle } from '../../core/lib/index.js';
/**
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing.
 */
export declare function flagsFromSpecs(specs: readonly ParameterSpec[], config: Config): string[];
/**
 * customArgFlags turns the card's Custom Arguments rows (`config.customArgs`)
 * into the flat flag list the adapters append to the launch argv. Each row is
 * a key (a flag, e.g. `--kv-dtype`) and an optional value: a row with a value
 * contributes `[key, value]`, a bare row contributes `[key]`. A row with a
 * blank key contributes nothing, and a non-array `customArgs` (an older config
 * that predates the key) reads as no custom args, so an engine that never had
 * the section launches unchanged.
 */
export declare function customArgFlags(config: Config): string[];
/**
 * customArgEnv turns the card's Custom Arguments rows (`config.customArgs`)
 * into the environment map the compose adapter appends to the plan's env: each
 * row's key becomes an env var set to its value. A row with no value is skipped,
 * because an empty env var is not a meaningful override. A non-array
 * `customArgs` (an older config that predates the key) reads as no custom args.
 */
export declare function customArgEnv(config: Config): Record<string, string>;
/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export declare function envFromSpecs(specs: readonly ParameterSpec[], config: Config): Record<string, string>;
/**
 * createNodeLifecycleHost builds the node `LifecycleHost`: `run` through the
 * system shell (a 10-minute cap, so a hung CUDA build cannot hang the panel),
 * `spawn` a detached child the stop step can signal, and `fetch` the health
 * URL. A fetch that throws (no route, connection refused) reads as status 0,
 * which the poll treats as not-ready. When `debug` is provided, the host logs
 * every command it issues (each `run` line and each `spawn` argv) through it,
 * so a DSH debug-mode host captures the full build-to-launch sequence.
 */
export declare function createNodeLifecycleHost(debug?: DebugLogger): LifecycleHost;
/**
 * nodeLifecycleHost is the default live host the service wires in: the node
 * implementation with no debug logger, so a normal (non-debug) run logs no
 * commands. The providers' apply step swaps in a debug-aware host when DSH is
 * in debug mode.
 */
export declare const nodeLifecycleHost: LifecycleHost;
/**
 * trackChild stores a spawned handle in the adapter's children map and ties
 * the entry's lifetime to the child's: when the child ends (a crash, a pkill,
 * or the adapter's own stop kill) the entry is dropped, so a later stop never
 * signals a pid a recycled process has taken over. A handle whose host cannot
 * watch (onExit absent) stays tracked until stop removes it.
 */
export declare function trackChild(children: Map<string, ProcessHandle>, key: string, handle: ProcessHandle): void;
/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep.
 */
export declare function pollHealth(host: LifecycleHost, plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>;
/**
 * delay waits `ms` milliseconds. The health polls use it between attempts; a
 * poll interval of 0 skips the wait, which the tests use to run the loop
 * without a real sleep.
 */
export declare function delay(ms: number): Promise<void>;
//# sourceMappingURL=adapters.d.ts.map