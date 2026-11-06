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
import { exec, execFile, spawn as nodeSpawn } from 'node:child_process';
import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { guardSudoCommand, LOG_TAIL_BYTES, SUDO_PROBE_COMMAND, sudoFailureDetail, } from '../../core/lib/index.js';
/**
 * deployTargets normalizes a spec's `deploy` declaration into a target list: a
 * single target wraps in a one-element list, a list passes through, and an
 * absent `deploy` reads as an empty list (the un-migrated fallback). The
 * spec-to-spelling helpers key off this list, so a multi-target spec
 * (cli + env, the Strata shared specs) contributes to every matching helper.
 */
export function deployTargets(spec) {
    const deploy = spec.deploy;
    if (deploy === undefined)
        return [];
    // Array.isArray narrows to any[], which does not exclude the readonly list
    // arm, so the single-target arm is cast to keep the union narrow.
    if (Array.isArray(deploy))
        return deploy;
    return [deploy];
}
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
export function flagsFromSpecs(specs, config) {
    const flags = [];
    for (const spec of specs) {
        if (spec.toArgv === undefined)
            continue;
        const targets = deployTargets(spec);
        if (targets.length > 0 && !targets.some((target) => target.target === 'cli'))
            continue;
        const value = config[spec.key] ?? spec.defaultValue;
        if (value === undefined)
            continue;
        flags.push(...spec.toArgv(value));
    }
    return flags;
}
/**
 * customArgFlags turns the card's Custom Arguments rows (`config.customArgs`)
 * into the flat flag list the adapters append to the launch argv. Each row is
 * a key (a flag, e.g. `--kv-dtype`) and an optional value: a row with a value
 * contributes `[key, value]`, a bare row contributes `[key]`. A row with a
 * blank key contributes nothing, and a non-array `customArgs` (an older config
 * that predates the key) reads as no custom args, so an engine that never had
 * the section launches unchanged.
 */
export function customArgFlags(config) {
    const raw = config.customArgs;
    if (!Array.isArray(raw))
        return [];
    const flags = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const key = entry.key;
        if (typeof key !== 'string' || key.trim() === '')
            continue;
        flags.push(key);
        const value = entry.value;
        if (typeof value === 'string' && value !== '') {
            flags.push(value);
        }
    }
    return flags;
}
/**
 * customArgEnv turns the card's Custom Arguments rows (`config.customArgs`)
 * into the environment map the compose adapter appends to the plan's env: each
 * row's key becomes an env var set to its value. A row with no value is skipped,
 * because an empty env var is not a meaningful override. A non-array
 * `customArgs` (an older config that predates the key) reads as no custom args.
 */
export function customArgEnv(config) {
    const raw = config.customArgs;
    if (!Array.isArray(raw))
        return {};
    const env = {};
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const key = entry.key;
        const value = entry.value;
        if (typeof key !== 'string' || key.trim() === '')
            continue;
        if (typeof value !== 'string' || value === '')
            continue;
        env[key] = value;
    }
    return env;
}
/**
 * envFromSpecs turns a spec surface and a config into the environment map: each
 * spec's `toEnv` runs over the config value (falling back to the spec default).
 * A spec with no `toEnv` contributes nothing. A declared `deploy` target gates
 * the spelling: an `env` target in the spec's target list (or no target, the
 * un-migrated fallback that reads the `toEnv` presence) spells env vars, so a
 * spec that deploys only to the CLI or a config file contributes no var even
 * when it carries a `toEnv` spelling.
 */
export function envFromSpecs(specs, config) {
    const env = {};
    for (const spec of specs) {
        if (spec.toEnv === undefined)
            continue;
        const targets = deployTargets(spec);
        if (targets.length > 0 && !targets.some((target) => target.target === 'env'))
            continue;
        const value = config[spec.key] ?? spec.defaultValue;
        if (value === undefined)
            continue;
        const [key, valueString] = spec.toEnv(value);
        env[key] = valueString;
    }
    return env;
}
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
export function configFileFromSpecs(specs, config, format) {
    const object = {};
    for (const spec of specs) {
        const targets = deployTargets(spec);
        const deployTarget = targets.find((target) => target.target === 'config');
        if (deployTarget === undefined)
            continue;
        // Prefer the CLI flag over the config write: a spec that also carries a
        // cli target spells the flag and leaves the on-disk config file (and any
        // hand edits in it) untouched.
        if (targets.some((target) => target.target === 'cli'))
            continue;
        const value = config[spec.key] ?? spec.defaultValue;
        if (value === undefined)
            continue;
        const resolved = spec.toConfig === undefined ? value : (spec.toConfig(value) ?? value);
        const block = deployTarget.block;
        const key = deployTarget.key ?? spec.key;
        if (block === undefined) {
            object[key] = resolved;
            continue;
        }
        configBlockEntry(object, block)[key] = resolved;
    }
    switch (format) {
        case 'json':
            return JSON.stringify(object, null, 2);
        case 'env':
            return renderEnv(object);
        case 'yaml':
            return renderYaml(object);
    }
}
/**
 * ARRAY_BLOCK_PATTERN matches the array-entry block convention: the name in
 * front of `[]` is the array's key, the `[]` marks the block's keys as entry
 * keys. A plain block name never matches.
 */
const ARRAY_BLOCK_PATTERN = /^(?<name>.+)\[\]$/;
/**
 * configBlockEntry returns the object one config block merges its keys into,
 * creating it on first use. A plain block names a top-level object. A `name[]`
 * block names the single object of a one-element array under `name`, so every
 * spec sharing the block writes into the same entry.
 */
function configBlockEntry(object, block) {
    const arrayBlock = ARRAY_BLOCK_PATTERN.exec(block);
    const name = arrayBlock?.groups?.name ?? block;
    const existing = object[name];
    // The array form reads back the entry it created and re-stamps the
    // one-element array, so the rendered shape stays `{"name": [{...}]}`.
    const held = arrayBlock === null
        ? existing
        : Array.isArray(existing)
            ? existing[0]
            : undefined;
    const entry = held !== null && typeof held === 'object'
        ? held
        : {};
    object[name] = arrayBlock === null ? entry : [entry];
    return entry;
}
/**
 * renderEnv flattens a nested config object into flat `KEY=VALUE` lines: a
 * top-level block object emits one line per leaf (the leaf key, not the block),
 * and a top-level scalar emits itself. Non-string leaves stringify through
 * String (numbers, booleans) or JSON (objects, arrays).
 */
function renderEnv(object) {
    const lines = [];
    for (const [key, value] of Object.entries(object)) {
        if (value !== null && typeof value === 'object') {
            for (const [leaf, leafValue] of Object.entries(value)) {
                lines.push(`${leaf}=${envValue(leafValue)}`);
            }
        }
        else {
            lines.push(`${key}=${envValue(value)}`);
        }
    }
    return lines.join('\n');
}
/**
 * envValue stringifies one `.env` leaf: strings pass through, numbers and
 * booleans through String, and anything else through JSON.
 */
function envValue(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return JSON.stringify(value);
}
/**
 * renderYaml stringifies a config object through the `yaml` package. The
 * package is a root devDependency (the YAML format is a test and optional path),
 * so it loads lazily through createRequire and the JSON/env paths never pay for
 * it at runtime.
 */
function renderYaml(object) {
    // createRequire anchors the lookup at this file, so the root devDependency
    // resolves through the parent node_modules even from the compiled lib/.
    const { stringify } = createRequire(import.meta.url)('yaml');
    return stringify(object);
}
/**
 * The cancel grace period in ms: an aborted run gets SIGINT first, and a child
 * still alive after the grace period gets SIGTERM, so a stuck child cannot
 * keep the run open.
 */
const RUN_ABORT_GRACE_MS = 5_000;
/**
 * The plain-run cap in ms: a 10-minute ceiling, so a hung CUDA build cannot
 * hang the panel. The streaming surface carries no overall cap (a full CUDA
 * build legitimately runs long), so the ceiling applies to run only.
 */
const RUN_TIMEOUT_MS = 600_000;
/**
 * The tail kept of a failed command's combined output: the detail a
 * CommandOutcome carries is the last KiB of stdout plus stderr, so a chatty
 * failure stays readable without growing the host's memory.
 */
const COMMAND_DETAIL_TAIL = 1_024;
/**
 * The streaming output's high-water mark and tail: a streamed command's
 * collected output is trimmed to the last KiB once it passes the mark, so a
 * long build's stream cannot grow the host's memory without bound.
 */
const STREAM_OUTPUT_HIGH_WATER = 2_048;
const STREAM_OUTPUT_TAIL = 1_024;
/**
 * The credential probe's timeout: a hung sudo must not sit in front of the
 * guarded command, so a slow probe reads as "a prompt is coming" (the safe
 * side), matching the service install runner's probe timeout.
 */
const SUDO_PROBE_TIMEOUT_MS = 5_000;
/**
 * sudoProbeCached answers whether sudo already holds cached (or NOPASSWD)
 * credentials: it runs SUDO_PROBE_COMMAND non-interactively and reads a clean
 * exit as cached. A refused -n, a missing sudo, and a hung probe all read as
 * "a prompt is coming", the safe side. Each package owns its child-process
 * wiring (the watchChildAbort note), so the lifecycle host keeps its own copy
 * beside the service's sudoProbe.
 */
function sudoProbeCached() {
    const [command, ...args] = SUDO_PROBE_COMMAND;
    if (command === undefined)
        return Promise.resolve(false);
    return new Promise(resolve => {
        execFile(command, args, { timeout: SUDO_PROBE_TIMEOUT_MS }, (error) => {
            resolve(error === null);
        });
    });
}
/**
 * The streaming children createNodeLifecycleHost spawned detached (process-
 * group leaders). signalProcess reads the set so the negative-pid group
 * signal only ever targets a child that actually leads its group: the plain
 * run's exec'd child (exec's options cannot set detached) stays in the
 * host's group and gets the direct signal.
 */
const detachedChildren = new WeakSet();
/**
 * signalProcess delivers one signal to one child: a process-group leader
 * gets it through its negative pid, so a compound command line
 * (`a && sudo b`) dies whole instead of leaving sudo as a group survivor;
 * every other child gets the direct signal. A simple sudo line is already
 * safe there: the shell execs a lone command, so the shell process is sudo
 * itself. A group that is already gone (ESRCH) or a platform that rejects
 * negative pids falls back to the direct signal, which reaches the shell.
 */
function signalProcess(child, signal) {
    if (child.pid !== undefined && detachedChildren.has(child)) {
        try {
            process.kill(-child.pid, signal);
            return;
        }
        catch {
            // Group gone or unsupported: the direct signal below still reaches the
            // shell, and a child that already exited no-ops the way ChildProcess
            // .kill always does.
        }
    }
    child.kill(signal);
}
/**
 * signalChild signals an in-flight child with the cancel rule: SIGINT first,
 * and SIGTERM after the grace period if the child is still alive. The child
 * already marked killed or exited is left alone. The optional graceMs
 * overrides the 5 s constant so a test can exercise the escalation without
 * waiting. The abort watch and the sudo deadline kill share this one rule,
 * the mirror of the service's copy (packages/service/src/index.ts,
 * signalChild): each package owns its child-process wiring, so a change to
 * the escalation rule lands in two places by design.
 */
function signalChild(child, graceMs) {
    if (child.killed || child.exitCode !== null)
        return;
    signalProcess(child, 'SIGINT');
    const escalate = setTimeout(() => {
        // A group signal never marks ChildProcess.kill, so the guard reads the
        // exit state: a child that has neither exited nor been signalled is
        // still alive and gets SIGTERM.
        if (child.exitCode === null && child.signalCode === null)
            signalProcess(child, 'SIGTERM');
    }, graceMs ?? RUN_ABORT_GRACE_MS);
    escalate.unref();
}
/**
 * watchChildAbort kills the in-flight child when the RunOptions signal
 * aborts (the card's cancel of a Get/Launch download) through the shared
 * signalChild rule. A signal that is already aborted kills immediately. A
 * near-identical copy lives in the service package
 * (packages/service/src/index.ts, the download runner's abort path): each
 * package owns its own child-process wiring, so a change to the escalation
 * rule lands in two places by design.
 */
function watchChildAbort(child, signal, graceMs) {
    if (signal === undefined)
        return;
    const onAbort = () => {
        signalChild(child, graceMs);
    };
    if (signal.aborted) {
        onAbort();
        return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
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
export function createNodeLifecycleHost(debug, sudo) {
    // The debug logger is a no-op outside debug mode, so the guard reads as
    // "log when a real sink is wired" and the command path stays quiet otherwise.
    const log = debug ?? undefined;
    /**
     * guardSudo drives core's sudo-prompt rule for one declared run: the run
     * carries needsSudo and the host has the hook, so the command probes first,
     * announces once, and arms the password deadline whose fire calls kill. An
     * undeclared run, or a host without the hook, resolves undefined: the run
     * goes through exactly as before.
     */
    const guardSudo = async (command, options, kill) => {
        if (sudo === undefined || options?.needsSudo !== true)
            return undefined;
        return guardSudoCommand({
            needsSudo: true,
            command,
            probe: sudoProbeCached,
            notify: sudo.notify,
            kill,
            ...(sudo.timeoutMs === undefined ? {} : { timeoutMs: sudo.timeoutMs }),
        });
    };
    return {
        async run(command, options) {
            log?.(`run: ${command}`);
            // The guard arms before the exec; the outer child exists so the
            // deadline's kill reaches the run through the shared signalChild rule.
            // The exec'd child cannot spawn detached (exec's options forbid it), so
            // it takes the direct signal; the deploy lines this path runs are
            // single `sudo ln -sf ...` commands, whose shell execs sudo itself.
            let child;
            const guard = await guardSudo(command, options, () => {
                if (child !== undefined)
                    signalChild(child, options?.graceMs);
            });
            try {
                const outcome = await new Promise((resolve) => {
                    // A profile shell (the Windows vcpkg route's pwsh.exe) runs the
                    // command line in that shell; absent keeps the system default.
                    const started = exec(command, { timeout: RUN_TIMEOUT_MS, shell: options?.shell }, (error, stdout, stderr) => {
                        if (error === null) {
                            resolve({ ok: true });
                            return;
                        }
                        const detail = `${stderr ?? ''}${stdout ?? ''}${String(error)}`.trim().slice(-COMMAND_DETAIL_TAIL);
                        resolve({ ok: false, detail });
                    });
                    child = started;
                    watchChildAbort(started, options?.signal, options?.graceMs);
                });
                // The password deadline killed the child: name the missed sudo prompt
                // regardless of the exit the signalled child reported.
                if (guard?.timedOut() === true) {
                    return { ok: false, detail: sudoFailureDetail(command) };
                }
                return outcome;
            }
            finally {
                // The command settled (its close or error path resolved it): the
                // password deadline is no longer owed.
                guard?.disarm();
            }
        },
        async runStream(command, onOutput, options) {
            log?.(`run: ${command}`);
            let child;
            const guard = await guardSudo(command, options, () => {
                if (child !== undefined)
                    signalChild(child, options?.graceMs);
            });
            try {
                const outcome = await new Promise((resolve) => {
                    // No overall timeout: a full CUDA build legitimately runs long, and
                    // the card prices a stalled step with its own output-idle watchdog.
                    // A profile shell (the Windows vcpkg route's pwsh.exe) runs the
                    // command line in that shell; absent keeps the system default.
                    // The build shell spawns detached so it leads its own process
                    // group and signalProcess's negative-pid signal reaches the whole
                    // line (build commands are compound). libuv's detached spawn only
                    // changes the process group (Node >= 22 ships libuv >= 1.48, which
                    // does not create a session), so a sudo prompt still reaches the
                    // launching terminal.
                    const started = nodeSpawn(command, {
                        shell: options?.shell ?? true,
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    child = started;
                    detachedChildren.add(started);
                    watchChildAbort(started, options?.signal, options?.graceMs);
                    let output = '';
                    const append = (chunk) => {
                        const text = chunk.toString('utf8');
                        onOutput(text);
                        output += text;
                        if (output.length > STREAM_OUTPUT_HIGH_WATER) {
                            output = output.slice(-STREAM_OUTPUT_TAIL);
                        }
                    };
                    started.stdout.on('data', append);
                    started.stderr.on('data', append);
                    started.on('error', error => {
                        resolve({ ok: false, detail: error.message });
                    });
                    started.on('close', code => {
                        if (code === 0) {
                            resolve({ ok: true });
                            return;
                        }
                        resolve({
                            ok: false,
                            detail: `exit ${code}: ${output.trim().slice(-COMMAND_DETAIL_TAIL)}`,
                        });
                    });
                });
                // The password deadline killed the child: name the missed sudo prompt
                // regardless of the exit the signalled child reported.
                if (guard?.timedOut() === true) {
                    return { ok: false, detail: sudoFailureDetail(command) };
                }
                return outcome;
            }
            finally {
                guard?.disarm();
            }
        },
        spawn(argv, env, cwd) {
            log?.(`spawn: ${argv.join(' ')}${cwd !== undefined ? ` (cwd: ${cwd})` : ''}`);
            // An empty argv (or an empty command) would spawn '' and hang the watcher
            // on a child that never starts. Settle the handle with a spawn error
            // detail instead, so the launch step reports the missing command.
            const command = argv[0];
            if (command === undefined || command === '') {
                const detail = 'spawn: no command in argv';
                const info = { code: null, signal: null, error: detail };
                return {
                    pid: -1,
                    kill: () => { },
                    logs: detail,
                    onExit: (listener) => {
                        listener(info);
                    },
                    // It settled with the spawn error at construction, so the state read
                    // reports true from the start.
                    hasExited: () => true,
                };
            }
            const child = nodeSpawn(command, argv.slice(1), {
                env: { ...process.env, ...env },
                cwd,
                detached: true,
                // Pipe the child's stdout and stderr so the launch step can surface the
                // engine's log output in the card and write it to the configured log
                // file; stdin stays ignored.
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            child.unref();
            // Accumulate the child's output into a single string the handle exposes.
            // The cap keeps a chatty engine from growing the host's memory without
            // bound; the tail is what the log file and the card keep.
            let logs = '';
            const append = (chunk) => {
                logs = (logs + chunk.toString('utf8')).slice(-LOG_TAIL_BYTES);
            };
            child.stdout?.on('data', append);
            child.stderr?.on('data', append);
            // An EventEmitter with no 'error' listener turns the event into a thrown
            // uncaughtException, which takes the DSH host down with it. A spawn that
            // cannot start (a missing engine binary, an ENOENT) and a stream that
            // breaks on a crashing child both emit 'error' here, so every path gets
            // a listener and the failure lands in the logs instead of the crash.
            child.stdout?.on('error', (error) => {
                logs = (logs + `stdout error: ${error.message}\n`).slice(-LOG_TAIL_BYTES);
            });
            child.stderr?.on('error', (error) => {
                logs = (logs + `stderr error: ${error.message}\n`).slice(-LOG_TAIL_BYTES);
            });
            // The one-shot exit contract: 'error' names a child that never ran,
            // 'exit' carries the code or signal, and 'close' follows once the pipes
            // drain. The first settled source wins, so the handle's onExit listener
            // (crash, pkill, or clean stop) fires exactly once with the detail.
            const listeners = new Set();
            let exitInfo = null;
            const settle = (info) => {
                if (exitInfo !== null)
                    return;
                exitInfo = info;
                for (const listener of listeners) {
                    try {
                        listener(info);
                    }
                    catch {
                        // A listener that throws must not re-raise into the child's event
                        // pipeline and take the host down the way an unlistened 'error' did.
                    }
                }
                listeners.clear();
            };
            let exitSignal = null;
            child.on('error', (error) => {
                logs = (logs + `spawn error: ${error.message}\n`).slice(-LOG_TAIL_BYTES);
                // The error fires before the stdio drains; settle immediately so a
                // launch of a missing binary reports rather than hangs the watcher.
                settle({ code: null, signal: null, error: error.message });
            });
            child.on('exit', (_code, signal) => {
                exitSignal = signal;
            });
            child.on('close', (code, signal) => {
                settle({ code, signal: signal ?? exitSignal });
            });
            return {
                pid: child.pid ?? -1,
                kill: () => {
                    child.kill('SIGTERM');
                },
                get logs() {
                    return logs;
                },
                onExit: (listener) => {
                    // A listener registered after the child already ended fires
                    // immediately, so a late attach (the service wiring after deploy)
                    // never misses the crash that landed in between.
                    if (exitInfo !== null) {
                        listener(exitInfo);
                        return;
                    }
                    listeners.add(listener);
                },
                // A state read of the settle state the onExit listener reads: a live
                // child reports false, and a child that ended (a crash, a pkill, or
                // a spawn failure) reports true.
                hasExited: () => exitInfo !== null,
            };
        },
        async writeFile(path, content) {
            log?.(`writeFile: ${path}`);
            // The parent directory may not exist (a fresh model directory), so the
            // mkdir runs before the write; recursive keeps an existing dir a no-op.
            await mkdir(dirname(path), { recursive: true });
            await fsWriteFile(path, content);
        },
        async fetch(url) {
            try {
                const response = await fetch(url);
                return { status: response.status, ok: response.ok };
            }
            catch {
                return { status: 0, ok: false };
            }
        },
        ...(log !== undefined ? { debug: log } : {}),
    };
}
/**
 * nodeLifecycleHost is the default live host the service wires in: the node
 * implementation with no debug logger, so a normal (non-debug) run logs no
 * commands. The providers' apply step swaps in a debug-aware host when DSH is
 * in debug mode.
 */
export const nodeLifecycleHost = createNodeLifecycleHost();
/**
 * trackChild stores a spawned handle in the adapter's children map and ties
 * the entry's lifetime to the child's: when the child ends (a crash, a pkill,
 * or the adapter's own stop kill) the entry is dropped, so a later stop never
 * signals a pid a recycled process has taken over. A handle whose host cannot
 * watch (onExit absent) stays tracked until stop removes it.
 */
export function trackChild(children, key, handle) {
    children.set(key, handle);
    handle.onExit?.(() => {
        // Compare identity before deleting: a newer launch that already replaced
        // this key's entry keeps its handle, and only the ended child's entry
        // goes.
        if (children.get(key) === handle) {
            children.delete(key);
        }
    });
}
/**
 * resolveLaunchArgv resolves a plan's launch argv against the engine
 * directory the spawn runs in: a relative path that carries a separator (a
 * build-tree binary, the NInfer Windows tree) is joined into an absolute
 * path, and a bare name (a binary on the path after the rebuild's symlink
 * step) is left as-is, so the spawn resolves the right command on every
 * platform.
 */
export function resolveLaunchArgv(engineDir, argv) {
    const resolved = [...(argv ?? [])];
    const first = resolved[0];
    if (engineDir !== undefined &&
        first !== undefined &&
        !isAbsolute(first) &&
        (first.includes('\\') || first.includes('/'))) {
        resolved[0] = join(engineDir, first);
    }
    return resolved;
}
/**
 * stopProcessPlan signals the engine process a stop targets when the adapter
 * tracks no child handle for it: an engine a DSH restart re-adopted from a
 * stored launch record carries no in-memory handle, so the stop signals the
 * pid the record stamped on the plan (kill on Linux and macOS, taskkill on a
 * Windows plan). A plan that names no pid is a no-op (nothing to signal), and
 * a kill the host reports as failed throws with the host's detail, so the
 * stop route names the broken step in the card's Logs section.
 */
export async function stopProcessPlan(host, plan) {
    if (plan.pid === undefined)
        return;
    const command = plan.os === 'windows' ? `taskkill /PID ${plan.pid} /T` : `kill ${plan.pid}`;
    const outcome = await host.run(command);
    if (!outcome.ok) {
        throw new Error(`stop: signal pid ${plan.pid} failed: ${outcome.detail ?? 'unknown'}`);
    }
}
/**
 * The health poll's defaults: the interval between attempts in ms and the
 * attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through, and an adapter that polls without options (or
 * with a partial one) reads these, so the defaults have one home.
 */
export const HEALTH_POLL_DEFAULT_MS = 1_000;
export const HEALTH_POLL_MAX_ATTEMPTS = 120;
/**
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep. `handle`
 * is the tracked child the deploy step spawned: when it reports it has
 * exited (hasExited true), the poll ends immediately with a failed result
 * instead of running the full attempt cap, so a crash reports at once. A
 * handle that cannot report its exit state (a stub) keeps the full poll.
 */
export async function pollHealth(host, plan, options, handle) {
    const pollMs = options?.pollMs ?? HEALTH_POLL_DEFAULT_MS;
    const maxAttempts = options?.maxAttempts ?? HEALTH_POLL_MAX_ATTEMPTS;
    let last = { status: 0, ok: false };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // The state read runs before the fetch: a child that settled (a crash,
        // a pkill, or a spawn failure) will never report 200, so the poll ends
        // here with a failed result naming the exit.
        if (handle?.hasExited?.() === true) {
            return {
                healthy: false,
                state: 'failed',
                detail: 'the engine process exited before it reported ready',
            };
        }
        last = await host.fetch(plan.healthUrl);
        if (last.status === 200) {
            return { healthy: true, status: 200 };
        }
        if (pollMs > 0 && attempt < maxAttempts) {
            await delay(pollMs);
        }
    }
    return {
        healthy: false,
        status: last.status,
        detail: `health check did not return 200 within ${maxAttempts} attempts`,
    };
}
/**
 * delay waits `ms` milliseconds. The health polls use it between attempts; a
 * poll interval of 0 skips the wait, which the tests use to run the loop
 * without a real sleep.
 */
export function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
//# sourceMappingURL=adapters.js.map
