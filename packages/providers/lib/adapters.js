/**
 * The shared engine-adapter helpers: the spec-to-argv and spec-to-env
 * translators the concrete adapters (the `engines/*Adapter.ts` files) compose
 * into a `LaunchPlan`, the card's Custom Arguments translators, the
 * `LifecycleHost` the deploy, health-check, and stop steps drive, and the
 * health poll. The node implementation (`nodeLifecycleHost`) is what the
 * service wires in on a live host.
 * @module dsh-plugin-local-infer/providers/adapters
 */
import { exec, spawn as nodeSpawn } from 'node:child_process';
/**
 * flagsFromSpecs turns a spec surface and a config into the CLI flag list: each
 * spec's `toArgv` runs over the config value (falling back to the spec
 * default), and empty results are skipped. A spec with no `toArgv` contributes
 * nothing.
 */
export function flagsFromSpecs(specs, config) {
    const flags = [];
    for (const spec of specs) {
        if (spec.toArgv === undefined)
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
 * spec's `toEnv` runs over the config value (falling back to the spec
 * default). A spec with no `toEnv` contributes nothing.
 */
export function envFromSpecs(specs, config) {
    const env = {};
    for (const spec of specs) {
        if (spec.toEnv === undefined)
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
 * createNodeLifecycleHost builds the node `LifecycleHost`: `run` through the
 * system shell (a 10-minute cap, so a hung CUDA build cannot hang the panel),
 * `spawn` a detached child the stop step can signal, and `fetch` the health
 * URL. A fetch that throws (no route, connection refused) reads as status 0,
 * which the poll treats as not-ready. When `debug` is provided, the host logs
 * every command it issues (each `run` line and each `spawn` argv) through it,
 * so a DSH debug-mode host captures the full build-to-launch sequence.
 */
export function createNodeLifecycleHost(debug) {
    // The debug logger is a no-op outside debug mode, so the guard reads as
    // "log when a real sink is wired" and the command path stays quiet otherwise.
    const log = debug ?? undefined;
    return {
        async run(command) {
            log?.(`run: ${command}`);
            return new Promise(resolve => {
                exec(command, { timeout: 600_000 }, (error, stdout, stderr) => {
                    if (error === null) {
                        resolve({ ok: true });
                        return;
                    }
                    const detail = `${stderr ?? ''}${stdout ?? ''}${String(error)}`.trim().slice(-1024);
                    resolve({ ok: false, detail });
                });
            });
        },
        async runStream(command, onOutput) {
            log?.(`run: ${command}`);
            return new Promise(resolve => {
                // No overall timeout: a full CUDA build legitimately runs long, and
                // the card prices a stalled step with its own output-idle watchdog.
                const child = nodeSpawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
                let output = '';
                const append = (chunk) => {
                    const text = chunk.toString('utf8');
                    onOutput(text);
                    output += text;
                    if (output.length > 2048) {
                        output = output.slice(-1024);
                    }
                };
                child.stdout.on('data', append);
                child.stderr.on('data', append);
                child.on('error', error => {
                    resolve({ ok: false, detail: error.message });
                });
                child.on('close', code => {
                    if (code === 0) {
                        resolve({ ok: true });
                        return;
                    }
                    resolve({ ok: false, detail: `exit ${code}: ${output.trim().slice(-1024)}` });
                });
            });
        },
        spawn(argv, env, cwd) {
            log?.(`spawn: ${argv.join(' ')}${cwd !== undefined ? ` (cwd: ${cwd})` : ''}`);
            const child = nodeSpawn(argv[0] ?? '', argv.slice(1), {
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
                logs = (logs + chunk.toString('utf8')).slice(-65536);
            };
            child.stdout?.on('data', append);
            child.stderr?.on('data', append);
            // An EventEmitter with no 'error' listener turns the event into a thrown
            // uncaughtException, which takes the DSH host down with it. A spawn that
            // cannot start (a missing engine binary, an ENOENT) and a stream that
            // breaks on a crashing child both emit 'error' here, so every path gets
            // a listener and the failure lands in the logs instead of the crash.
            child.stdout?.on('error', (error) => {
                logs = (logs + `stdout error: ${error.message}\n`).slice(-65536);
            });
            child.stderr?.on('error', (error) => {
                logs = (logs + `stderr error: ${error.message}\n`).slice(-65536);
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
                logs = (logs + `spawn error: ${error.message}\n`).slice(-65536);
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
            };
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
 * pollHealth polls a plan's health URL until a 200 or the attempt cap, the
 * same loop the qwen-ninfer launcher runs. A poll interval of 0 skips the
 * delay, which the tests use to run the loop without a real sleep.
 */
export async function pollHealth(host, plan, options) {
    const pollMs = options?.pollMs ?? 1000;
    const maxAttempts = options?.maxAttempts ?? 120;
    let last = { status: 0, ok: false };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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