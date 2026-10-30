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
import { NINFER_LINUX } from "./engines/ninferLinux.js";
import { NINFER_MACOS } from "./engines/ninferMacOS.js";
import { NINFER_WINDOWS } from "./engines/ninferWindows.js";
import { INFERNIX_LINUX } from "./engines/infernixLinux.js";
import { INFERNIX_MACOS } from "./engines/infernixMacOS.js";
import { INFERNIX_WINDOWS } from "./engines/infernixWindows.js";
import { LLAMACPP_LINUX } from "./engines/llamacppLinux.js";
import { LLAMACPP_MACOS } from "./engines/llamacppMacOS.js";
import { LLAMACPP_WINDOWS } from "./engines/llamacppWindows.js";
import { HYPERQWEN_LINUX } from "./engines/hyperqwenLinux.js";
import { HYPERQWEN_MACOS } from "./engines/hyperqwenMacOS.js";
import { HYPERQWEN_WINDOWS } from "./engines/hyperqwenWindows.js";
import { STRATA_LINUX } from "./engines/strataLinux.js";
import { STRATA_MACOS } from "./engines/strataMacOS.js";
import { STRATA_WINDOWS } from "./engines/strataWindows.js";
/**
 * The remote name a user-provided fork is added under, so the checkout's own
 * origin (the upstream it was cloned from) survives the fork override.
 */
export const FORK_REMOTE = 'dsh-fork';
/**
 * The per-engine, per-OS build profiles, keyed by engine id then OS. The
 * distro-specific Linux profiles (Arch, Debian, Fedora) reuse the shared Linux
 * profile, so they are not separate keys here. A host OS with no dedicated
 * profile (a Windows host for an engine that carries no Windows route) reads
 * the shared Linux profile.
 */
const ENGINE_OS_PROFILES = {
    ninfer: { linux: NINFER_LINUX, macos: NINFER_MACOS, windows: NINFER_WINDOWS },
    hyperqwen: { linux: HYPERQWEN_LINUX, macos: HYPERQWEN_MACOS, windows: HYPERQWEN_WINDOWS },
    llamacpp: { linux: LLAMACPP_LINUX, macos: LLAMACPP_MACOS, windows: LLAMACPP_WINDOWS },
    infernix: { linux: INFERNIX_LINUX, macos: INFERNIX_MACOS, windows: INFERNIX_WINDOWS },
    strata: { linux: STRATA_LINUX, macos: STRATA_MACOS, windows: STRATA_WINDOWS },
};
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
export const ENGINE_SOURCES = {
    ninfer: {
        repo: 'https://github.com/Neroued/ninfer',
        branch: 'master',
        buildSteps: NINFER_LINUX.buildSteps,
        // The Windows route is the ninfer-all fork's vcpkg build: the manifest
        // pulls the dev libraries, then the engine's own build-native.bat
        // configures and builds. The step cds into the checkout first (the {dir}
        // placeholder), because vcpkg install and the relative script path both
        // resolve against the checkout root.
        windowsBuildSteps: NINFER_WINDOWS.buildSteps,
    },
    hyperqwen: {
        repo: 'https://github.com/vllm-project/vllm',
        branch: 'main',
        buildSteps: HYPERQWEN_LINUX.buildSteps,
    },
    llamacpp: {
        repo: 'https://github.com/ggml-org/llama.cpp',
        branch: 'master',
        buildSteps: LLAMACPP_LINUX.buildSteps,
    },
    infernix: {
        repo: 'https://github.com/Wallawalla47/Infernix',
        branch: 'main',
        buildSteps: INFERNIX_LINUX.buildSteps,
    },
    strata: {
        // The README's Build-from-source route: git clone the repo, then run the
        // engine's own setup.sh. `--yes` takes the recommended answer to every
        // question (no prompts) and `--no-start` builds and installs the engine
        // without starting the server, which the adapter's launch step then does.
        repo: 'https://github.com/Niko1221/Strata',
        branch: 'main',
        buildSteps: STRATA_LINUX.buildSteps,
    },
};
/**
 * engineOsProfile reads the registered build profile for an engine id on an OS,
 * or undefined when none is registered. A host OS with no dedicated profile
 * (a Windows host for an engine that carries no Windows route) reads the
 * shared Linux profile.
 */
export function engineOsProfile(engineId, os = 'linux') {
    const profiles = ENGINE_OS_PROFILES[engineId];
    if (profiles === undefined)
        return undefined;
    return profiles[os] ?? profiles.linux;
}
/**
 * engineBuildDir reads the directory, relative to the checkout, where an
 * engine's build leaves its binary on an OS, so the binary symlink step reads
 * the right tree. A Windows host reads the engine's Windows build tree (the
 * vcpkg route for NInfer writes into build-windows\apps\Release); every other
 * host reads the shared Linux build directory. An engine that installs its
 * binary to the path (Strata) carries no build directory, so it reads as
 * `build`, the shared default.
 */
export function engineBuildDir(engineId, os = 'linux') {
    return engineOsProfile(engineId, os)?.buildDir ?? 'build';
}
/**
 * engineBinary reads the engine binary name on an OS (the .exe on Windows), so
 * the adapters and the symlink step share one source. An engine with no local
 * binary (the compose engines) reads as undefined.
 */
export function engineBinary(engineId, os = 'linux') {
    return engineOsProfile(engineId, os)?.binary;
}
/**
 * engineSource reads the registered acquisition data for an engine id, or
 * undefined when none is registered.
 */
export function engineSource(engineId) {
    return ENGINE_SOURCES[engineId];
}
/**
 * engineBuildSteps reads the build steps an engine runs in its checkout for an
 * OS, so the adapter's deploy step and the Get build step share one list. The
 * steps come from the engine's OS profile: a Windows host reads the engine's
 * Windows profile (the vcpkg route for NInfer), and a host OS with no
 * dedicated profile reads the shared Linux profile.
 */
export function engineBuildSteps(engineId, os = 'linux') {
    return engineOsProfile(engineId, os)?.buildSteps ?? [];
}
/**
 * runLogged runs one shell command through the host's streaming surface when
 * it has one (echoing the command and streaming its output through log), and
 * through plain run otherwise. The streamed copy is also collected, so a
 * caller can price the command's stdout (the dirty-check, for one).
 */
async function runLogged(host, command, log, options) {
    let output = '';
    const collect = (chunk) => {
        output += chunk;
        log(chunk);
    };
    if (options?.echo !== false) {
        log(`$ ${command}\n`);
    }
    if (host.runStream !== undefined) {
        const outcome = await host.runStream(command, collect);
        return { ...outcome, output };
    }
    const outcome = await host.run(command);
    return { ...outcome, output };
}
/**
 * syncEngineRepo brings the engine checkout to the listed source. A missing
 * checkout is a fresh clone of the fork (or the engine's upstream repo when
 * no fork is provided). An existing checkout with local changes aborts, so
 * the user's work is never rebased away; a clean checkout fetches the listed
 * fork (added as the named fork remote when provided, origin when not) and
 * rebases onto its branch. Every command echoes into log as it runs.
 */
export async function syncEngineRepo(host, request, log) {
    const source = engineSource(request.engineId);
    if (source === undefined) {
        return {
            ok: false,
            detail: `no engine source is registered for "${request.engineId}"`,
        };
    }
    const directory = request.directory;
    const fork = request.fork !== undefined && request.fork.trim() !== '' ? request.fork : undefined;
    const present = await host.run(`[ -d ${directory}/.git ]`);
    if (present.ok) {
        const status = await runLogged(host, `git -C ${directory} status --short`, log);
        if (!status.ok) {
            return { ok: false, detail: `git status failed: ${status.detail ?? 'unknown'}` };
        }
        if (status.output.trim() !== '') {
            log(`!! ${directory} has local changes. Get aborted; commit or revert them first.\n`);
            return {
                ok: false,
                aborted: true,
                detail: 'the engine repository has local changes',
            };
        }
        if (fork !== undefined) {
            // Add the fork under its own remote name; re-Get updates the URL in
            // place so an edited Engine Fork field takes effect on the next run.
            const add = await runLogged(host, `git -C ${directory} remote add ${FORK_REMOTE} ${fork}`, log);
            if (!add.ok) {
                await runLogged(host, `git -C ${directory} remote set-url ${FORK_REMOTE} ${fork}`, log);
            }
        }
        const remote = fork !== undefined ? FORK_REMOTE : 'origin';
        const fetch = await runLogged(host, `git -C ${directory} fetch ${remote}`, log);
        if (!fetch.ok) {
            return { ok: false, detail: `git fetch ${remote} failed: ${fetch.detail ?? 'unknown'}` };
        }
        const rebase = await runLogged(host, `git -C ${directory} rebase ${remote}/${source.branch} || ` +
            `{ git -C ${directory} rebase --abort; exit 1; }`, log);
        if (!rebase.ok) {
            return {
                ok: false,
                detail: `git rebase ${remote}/${source.branch} failed: ${rebase.detail ?? 'unknown'}`,
            };
        }
        return { ok: true };
    }
    const clone = await runLogged(host, `git clone ${fork ?? source.repo} ${directory}`, log);
    if (!clone.ok) {
        return { ok: false, detail: `git clone failed: ${clone.detail ?? 'unknown'}` };
    }
    return { ok: true };
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
export async function syncAndRebuildEngine(host, request, log) {
    const source = engineSource(request.engineId);
    if (source === undefined) {
        return {
            ok: false,
            rebuilt: false,
            detail: `no engine source is registered for "${request.engineId}"`,
            logs: '',
        };
    }
    const directory = request.directory;
    const fork = request.fork !== undefined && request.fork.trim() !== '' ? request.fork : undefined;
    const remote = fork !== undefined ? FORK_REMOTE : 'origin';
    const chunks = [];
    const emit = (chunk) => {
        chunks.push(chunk);
        log(chunk);
    };
    const present = await host.run(`[ -d ${directory}/.git ]`);
    let rebuilt = false;
    if (!present.ok) {
        // A missing checkout is a fresh clone of the fork (or the upstream repo),
        // which always needs a build.
        emit(`>> cloning ${fork ?? source.repo} into ${directory}\n`);
        const clone = await runLogged(host, `git clone ${fork ?? source.repo} ${directory}`, emit);
        if (!clone.ok) {
            return {
                ok: false,
                rebuilt: false,
                detail: `git clone failed: ${clone.detail ?? 'unknown'}`,
                logs: chunks.join(''),
            };
        }
        rebuilt = true;
    }
    else {
        if (fork !== undefined) {
            // Add the fork under its own remote name; a re-launch updates the URL in
            // place so an edited fork field takes effect on the next run.
            const add = await runLogged(host, `git -C ${directory} remote add ${FORK_REMOTE} ${fork}`, emit, { echo: false });
            if (!add.ok) {
                await runLogged(host, `git -C ${directory} remote set-url ${FORK_REMOTE} ${fork}`, emit, { echo: false });
            }
        }
        const status = await runLogged(host, `git -C ${directory} status --short`, emit, { echo: false });
        if (!status.ok) {
            return {
                ok: false,
                rebuilt: false,
                detail: `git status failed: ${status.detail ?? 'unknown'}`,
                logs: chunks.join(''),
            };
        }
        if (status.output.trim() !== '') {
            emit(`!! ${directory} has local changes; the rebase and rebuild are skipped.\n`);
            return { ok: true, rebuilt: false, logs: chunks.join('') };
        }
        // The fetch is best-effort: an offline host prices the checkout it has.
        await runLogged(host, `git -C ${directory} fetch ${remote} || true`, emit, { echo: false });
        // Price whether the current branch is behind the remote branch. A fetch
        // that failed (offline) or a missing remote branch reads as not-behind, so
        // the checkout builds as-is.
        const count = await runLogged(host, `git -C ${directory} rev-list --count HEAD..${remote}/${source.branch} 2>/dev/null || echo 0`, emit, { echo: false });
        const behind = (count.output.trim() || '0') !== '0';
        if (behind) {
            emit(`>> ${directory} is behind ${remote}/${source.branch}; rebasing and rebuilding.\n`);
            const checkout = await runLogged(host, `git -C ${directory} checkout ${source.branch}`, emit);
            if (!checkout.ok) {
                return {
                    ok: false,
                    rebuilt: false,
                    detail: `git checkout ${source.branch} failed: ${checkout.detail ?? 'unknown'}`,
                    logs: chunks.join(''),
                };
            }
            const rebase = await runLogged(host, `git -C ${directory} rebase ${remote}/${source.branch} || ` +
                `{ git -C ${directory} rebase --abort; exit 1; }`, emit);
            if (!rebase.ok) {
                return {
                    ok: false,
                    rebuilt: false,
                    detail: `git rebase ${remote}/${source.branch} failed: ${rebase.detail ?? 'unknown'}`,
                    logs: chunks.join(''),
                };
            }
            const clean = await runLogged(host, `git -C ${directory} clean -fxd`, emit);
            if (!clean.ok) {
                return {
                    ok: false,
                    rebuilt: false,
                    detail: `git clean -fxd failed: ${clean.detail ?? 'unknown'}`,
                    logs: chunks.join(''),
                };
            }
            rebuilt = true;
        }
        else {
            emit(`>> ${directory} is up to date with ${remote}/${source.branch}; the rebuild is skipped.\n`);
        }
    }
    if (rebuilt) {
        // The user's local build command (the card's Build commands field)
        // overrides the engine's default build steps: it runs in the checkout, so
        // it is wrapped with a cd into the directory. Absent falls back to the
        // engine's acquisition build steps.
        const buildCommands = request.buildCommands !== undefined && request.buildCommands.trim() !== ''
            ? request.buildCommands
            : undefined;
        const steps = buildCommands !== undefined
            ? [`cd ${directory} && ${buildCommands}`]
            : engineBuildSteps(request.engineId, request.os ?? 'linux');
        // Report the build phase before the first step runs, so the card's button
        // reads "Building..." while the build is in flight, not after it completes.
        request.onBuildStart?.();
        for (const step of steps) {
            const command = step.replaceAll('{dir}', directory);
            const outcome = await runLogged(host, command, emit);
            if (!outcome.ok) {
                return {
                    ok: false,
                    rebuilt: true,
                    detail: `build failed: ${outcome.detail ?? 'unknown'}`,
                    logs: chunks.join(''),
                };
            }
        }
        // A rebuild that did not install the binary (no make install) leaves it
        // out of the path. Check, and add a symlink when the trust gate allows.
        const binary = request.binary;
        if (binary !== undefined) {
            const which = await host.run(`command -v ${binary}`);
            if (!which.ok) {
                // The build directory is OS-specific: a Windows host reads the
                // engine's Windows build tree (the vcpkg route for NInfer writes into
                // build-windows\apps\Release), every other host the shared Linux build
                // directory.
                const buildDir = engineBuildDir(request.engineId, request.os ?? 'linux');
                const link = `sudo ln -sf ${directory}/${buildDir}/${binary} /usr/local/bin/${binary}`;
                if (request.allowRunDeps === true) {
                    const result = await runLogged(host, link, emit);
                    if (!result.ok) {
                        emit(`!! ${link} failed: ${result.detail ?? 'unknown'}\n`);
                    }
                }
                else {
                    emit(`!! ${binary} is not on the path; run ${link} (the provider command must be on the path to launch)\n`);
                }
            }
        }
    }
    return { ok: true, rebuilt, logs: chunks.join('') };
}
/**
 * buildEngineRepo runs the engine's build steps in the checkout, streaming
 * each step's output through log. An engine with no build steps (the compose
 * engines) passes through with a note; a failing step stops the build with
 * the step's detail.
 */
export async function buildEngineRepo(host, engineId, directory, log, buildCommands, os = 'linux') {
    const source = engineSource(engineId);
    if (source === undefined) {
        return { ok: false, detail: `no engine source is registered for "${engineId}"` };
    }
    // The user's local build command (the card's Build commands field) overrides
    // the engine's default build steps: it runs in the checkout, so it is wrapped
    // with a cd into the directory. Absent falls back to the engine's steps for
    // the host OS (the Windows vcpkg route on a Windows host).
    const commands = buildCommands !== undefined && buildCommands.trim() !== '' ? buildCommands : undefined;
    const steps = commands !== undefined ? [`cd ${directory} && ${commands}`] : engineBuildSteps(engineId, os);
    if (steps.length === 0) {
        log(`no local build steps for ${engineId}\n`);
        return { ok: true };
    }
    for (const step of steps) {
        const command = step.replaceAll('{dir}', directory);
        const outcome = await runLogged(host, command, log);
        if (!outcome.ok) {
            return { ok: false, detail: `build failed: ${outcome.detail ?? 'unknown'}` };
        }
    }
    return { ok: true };
}
//# sourceMappingURL=acquire.js.map