/**
 * The shared engine-adapter helpers: the spec-to-argv and spec-to-env
 * translators the concrete adapters (the `engines/<engine>/<engine>Adapter.ts`
 * files) compose
 * into a `LaunchPlan`, the card's Custom Arguments translators, the
 * `LifecycleHost` the deploy, health-check, and stop steps drive, and the
 * health poll. The node implementation (`nodeLifecycleHost`) is what the
 * service wires in on a live host.
 * @module dsh-plugin-local-infer/providers/adapters
 */
import type { CommandLogger, CommandOutcome, Config, DebugLogger, HealthCheckOptions, HealthResult, LaunchPlan, LifecycleHost, ParameterDeploy, ParameterSpec, ProcessHandle, RunOptions } from '../../core/lib/index.js';
/**
 * deployTargets normalizes a spec's `deploy` declaration into a target list: a
 * single target wraps in a one-element list, a list passes through, and an
 * absent `deploy` reads as an empty list (the un-migrated fallback). The
 * spec-to-spelling helpers key off this list, so a multi-target spec
 * (cli + env, the Strata shared specs) contributes to every matching helper.
 */
export declare function deployTargets(spec: ParameterSpec): readonly ParameterDeploy[];
/**
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing. A declared `deploy` target gates the spelling: a `cli` target in the
 * spec's target list (or no target, the un-migrated fallback that reads the
 * `toArgv` presence) spells CLI flags, so a spec that deploys only to the env
 * or a config file contributes no flag even when it carries a `toArgv`
 * spelling.
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
 * spec's `toEnv` runs over the config value (falling back to the spec default).
 * A spec with no `toEnv` contributes nothing. A declared `deploy` target gates
 * the spelling: an `env` target in the spec's target list (or no target, the
 * un-migrated fallback that reads the `toEnv` presence) spells env vars, so a
 * spec that deploys only to the CLI or a config file contributes no var even
 * when it carries a `toEnv` spelling.
 */
export declare function envFromSpecs(specs: readonly ParameterSpec[], config: Config): Record<string, string>;
/**
 * ConfigFileFormat is the on-disk format a `config` deploy target renders to:
 * JSON (the built-in stringify), a flat `.env` file, or YAML.
 */
export type ConfigFileFormat = 'json' | 'yaml' | 'env';
/**
 * configFileFromSpecs turns a spec surface and a config into the content of the
 * config file the deploy step writes: every spec whose target list carries a
 * `config` target resolves its value (`toConfig(value) ?? value`, falling back
 * to the spec default) and nests it under that target's `block` / `key` (the
 * key defaults to the spec key), then the result renders in the requested
 * format. A spec with no `deploy`, or no `config` target, contributes nothing.
 *
 * A `block` ending in `[]` (e.g. `models[]`) follows the array-entry
 * convention: the key lands inside the single object of a one-element array
 * named by the prefix, and every spec sharing that block merges into that one
 * entry. A plain block name nests as before, into one top-level object.
 *
 * A spec that carries both a `config` and a `cli` target contributes nothing
 * here: the launch spells the CLI flag and leaves the on-disk config file (and
 * any hand edits in it) untouched. Only a spec whose sole deploy path is the
 * config file writes it.
 *
 * The YAML format loads the `yaml` package lazily (a root devDependency, so the
 * JSON and env paths never touch it at runtime); a missing package throws only
 * when the YAML format is requested.
 */
export declare function configFileFromSpecs(specs: readonly ParameterSpec[], config: Config, format: ConfigFileFormat): string;
/**
 * SudoHook is the optional sudo wiring createNodeLifecycleHost takes: `notify`
 * announces a guarded command the probe found waiting for a password on the
 * launching CLI (the service's sudo observer turns it into the Logs note), and
 * `timeoutMs` overrides the 60 s password deadline. A host built without the
 * hook never probes, announces, or caps a run.
 */
export interface SudoHook {
    notify: (command: string) => void;
    timeoutMs?: number;
}
/**
 * createNodeLifecycleHost builds the node `LifecycleHost`: `run` through the
 * system shell (a 10-minute cap, so a hung CUDA build cannot hang the panel),
 * `spawn` a detached child the stop step can signal, `writeFile` the config
 * file the deploy step renders (creating the parent directory), and `fetch`
 * the health URL. A fetch that throws (no route, connection refused) reads as status 0,
 * which the poll treats as not-ready. When `debug` is provided, the host logs
 * every command it issues (each `run` line and each `spawn` argv) through it,
 * so a DSH debug-mode host captures the full build-to-launch sequence. A
 * `RunOptions.shell` (the engine OS profile's shell, e.g. pwsh.exe for
 * the Windows vcpkg route) runs the command line in that shell instead of the
 * system default. A `RunOptions.graceMs` overrides the 5 s SIGTERM escalation
 * window of the abort path for that run. The optional `sudo` hook wires the
 * sudo-prompt rule: a run whose `RunOptions.needsSudo` declares sudo probes
 * cached credentials first, announces a waiting prompt through the hook once,
 * and dies at the password deadline with the `sudoFailureDetail` outcome. A
 * host built without the hook never probes, announces, or caps a run.
 */
export declare function createNodeLifecycleHost(debug?: DebugLogger, sudo?: SudoHook): LifecycleHost;
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
 * resolveLaunchArgv resolves a plan's launch argv against the engine
 * directory the spawn runs in: a relative path that carries a separator (a
 * build-tree binary, the NInfer Windows tree) is joined into an absolute
 * path, and a bare name (a binary on the path after the rebuild's symlink
 * step) is left as-is, so the spawn resolves the right command on every
 * platform.
 */
export declare function resolveLaunchArgv(engineDir: string | undefined, argv: readonly string[] | undefined): string[];
/**
 * auditRun runs one mutating host command through the run's log sink: the
 * `$ <command>` line reaches the sink before the child spawns, and the
 * outcome's success output tail reaches it after the child settles, so the
 * launch or stop run reads the command ahead of its result (the URL-query
 * rule applied to execs: line first, settled outcome after). No sink (a
 * headless call) and the command runs as before. A failed outcome lands no
 * output here: the caller's own failure line carries the detail's output
 * tail. The deploy and stop steps share this one audit rule for their direct
 * `host.run` calls; the git and build steps run through the acquire step's
 * own command-first echo.
 */
export declare function auditRun(host: LifecycleHost, command: string, log?: CommandLogger, options?: RunOptions): Promise<CommandOutcome>;
/**
 * stopProcessPlan signals the engine process a stop targets when the adapter
 * tracks no child handle for it: an engine a DSH restart re-adopted from a
 * stored launch record carries no in-memory handle, so the stop signals the
 * pid the record stamped on the plan (kill on Linux and macOS, taskkill on a
 * Windows plan). The optional `log` is the stop run's log sink: the signal
 * command's `$ <command>` line reaches it before the child runs. A plan that
 * names no pid is a no-op (nothing to signal), and a kill the host reports as
 * failed throws with the host's detail, so the stop route names the broken
 * step in the card's Logs section.
 */
export declare function stopProcessPlan(host: LifecycleHost, plan: LaunchPlan, log?: CommandLogger): Promise<void>;
/**
 * The health poll's defaults: the interval between attempts in ms and the
 * attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through, and an adapter that polls without options (or
 * with a partial one) reads these, so the defaults have one home.
 */
export declare const HEALTH_POLL_DEFAULT_MS = 1000;
export declare const HEALTH_POLL_MAX_ATTEMPTS = 120;
/**
 * logHealthPoll brackets a health poll with the URL-query logging rule (the
 * exec rule's URL twin): the one `> GET <url>` line reaches the run's log
 * sink before the first request, the retries stay silent, and the settled
 * verdict line (`> GET <url> ready`, Strata's still-downloading line, or the
 * `!!` failure with the last detail) lands after the poll returns. The
 * shared poll and the Strata poll both wrap their loop in this, so the rule
 * has one home. `log` absent (a headless poll) runs the poll unlogged.
 */
export declare function logHealthPoll(log: CommandLogger | undefined, url: string, poll: () => Promise<HealthResult>): Promise<HealthResult>;
/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep. `handle`
 * is the tracked child the deploy step spawned: when it reports it has
 * exited (hasExited true), the poll ends immediately with a failed result
 * instead of running the full attempt cap, so a crash reports at once. A
 * handle that cannot report its exit state (a stub) keeps the full poll.
 * The poll's URL logging (the one `> GET` line ahead of the settled verdict)
 * rides the shared logHealthPoll wrap when options.onLog carries the run's
 * log sink.
 */
export declare function pollHealth(host: LifecycleHost, plan: LaunchPlan, options?: HealthCheckOptions, handle?: ProcessHandle): Promise<HealthResult>;
/**
 * delay waits `ms` milliseconds. The health polls use it between attempts; a
 * poll interval of 0 skips the wait, which the tests use to run the loop
 * without a real sleep.
 */
export declare function delay(ms: number): Promise<void>;
//# sourceMappingURL=adapters.d.ts.map
