/**
 * planDepsForOs reads the dep list a plan carries for a build mode on an OS.
 * A Windows host reads the plan's `windows` variant for the mode when present
 * and falls back to the base list when it is not; every other OS reads the
 * base list. A mode the plan does not carry (a binary list for a non-Strata
 * engine) reads as an empty list.
 */
export function planDepsForOs(plan, buildMode, os) {
    if (os === 'windows' && plan.windows !== undefined) {
        return plan.windows[buildMode] ?? plan[buildMode] ?? [];
    }
    return plan[buildMode] ?? [];
}
/**
 * osLabel is the friendly OS name the install string's header and the card's
 * System dependencies section show: WSL on a WSL2 kernel, Windows on Windows,
 * OSX on macOS, and Linux on every other Linux host.
 */
export function osLabel(hw) {
    if (hw.os === 'windows')
        return 'Windows';
    if (hw.os === 'macos')
        return 'OSX';
    return hw.wsl2 === true ? 'WSL' : 'Linux';
}
/**
 * detectPackageManager picks the single package manager the install commands
 * key against, from the which-probe results. macOS keys on brew. Windows keys
 * on winget, the package manager that ships with the OS. Linux tries the
 * distro-native manager in the order the plan lists them (apt, dnf, pacman);
 * a distro that ships two keeps the first. A host whose manager probe reads
 * absent reads as undetected, which the renderer degrades to.
 */
export function detectPackageManager(probes) {
    if (probes.os === 'macos') {
        return probes.brew ? 'brew' : undefined;
    }
    if (probes.os === 'windows') {
        return probes.winget ? 'winget' : undefined;
    }
    if (probes.os === 'linux') {
        if (probes.apt)
            return 'apt';
        if (probes.dnf)
            return 'dnf';
        if (probes.pacman)
            return 'pacman';
    }
    return undefined;
}
/**
 * planDeps is the relationship edge from engine to host deps: the deps the
 * engine's deploy step needs for the requested build mode. An adapter that
 * declares none (the Phase 5 adapters will) plans an empty list, and the
 * service falls back to the provider-registered plan for the engine id.
 */
export function planDeps(engine, buildMode, hw) {
    return engine.systemDeps?.(buildMode, hw) ?? [];
}
/**
 * checkDeps probes every dep and reports its status. A dep without a detect
 * probe reads as missing, not satisfied: an unknown state degrades to the
 * state the user can fix by copy-pasting the install string and re-checking.
 */
export async function checkDeps(deps, hw) {
    const checks = [];
    for (const dep of deps) {
        const satisfied = dep.detect === undefined ? false : await dep.detect(hw);
        checks.push({ dep, status: satisfied ? 'satisfied' : 'missing' });
    }
    return checks;
}
/**
 * The manager order the unknown-package-manager rendering groups its blocks
 * in. It is the order the plan lists them, so the block the user's host
 * would have picked sits at the top.
 */
const MANAGER_ORDER = ['apt', 'dnf', 'pacman', 'brew', 'winget'];
/**
 * renderInstallString emits the copy/paste block for the user's detected OS
 * and package manager, mirroring the qwen-ninfer header: the apt and CUDA-
 * keyring lines plus the export on Debian/Ubuntu, the pacman lines plus the
 * exports on Arch. Every dep contributes its purpose comment, its commands
 * (or a by-hand note when the detected manager has none for it), and its
 * envAfter exports. When no package manager is detected the block groups the
 * commands by manager, because the user has to pick the one for their system.
 */
export function renderInstallString(deps, hw) {
    const pm = hw.packageManager;
    const lines = [];
    lines.push(`# System dependencies on ${osLabel(hw)}`);
    if (pm === undefined) {
        lines.push('# No package manager detected; blocks are grouped by manager.');
    }
    else {
        lines.push(`# Package manager: ${pm}`);
    }
    for (const dep of deps) {
        lines.push(`# ${dep.id}: ${dep.purpose}`);
        if (pm === undefined) {
            for (const manager of MANAGER_ORDER) {
                const commands = dep.install[manager];
                if (commands === undefined)
                    continue;
                lines.push(`# --- ${manager} ---`);
                for (const command of commands.commands) {
                    lines.push(command);
                }
                appendExports(lines, commands.envAfter);
            }
            continue;
        }
        const commands = dep.install[pm];
        if (commands === undefined || commands.commands.length === 0) {
            lines.push(`# no ${pm} install commands for ${dep.id}; install it by hand`);
            continue;
        }
        for (const command of commands.commands) {
            lines.push(command);
        }
        appendExports(lines, commands.envAfter);
    }
    return lines.join('\n');
}
/**
 * appendExports writes the post-install env exports, one line per variable,
 * in the object's key order so the block is deterministic.
 */
function appendExports(lines, envAfter) {
    if (envAfter === undefined)
        return;
    for (const [key, value] of Object.entries(envAfter)) {
        lines.push(`export ${key}=${value}`);
    }
}
/**
 * runInstall is the Play/Run path: it runs each missing dep's commands in
 * order through the injected runner, stops a dep at its first failed command
 * (capturing the exit detail), then re-runs the probe to confirm. A dep the
 * probe cannot confirm (no detect, or the probe still reads missing after a
 * clean run) reports failed, because the user cannot be told "installed" for
 * a state the plugin did not see.
 */
export async function runInstall(deps, hw, runCommand) {
    const pm = hw.packageManager;
    const results = [];
    for (const dep of deps) {
        if (await isSatisfied(dep, hw)) {
            results.push({ id: dep.id, status: 'satisfied' });
            continue;
        }
        const commands = pm === undefined ? undefined : dep.install[pm];
        if (commands === undefined || commands.commands.length === 0) {
            results.push({
                id: dep.id,
                status: 'missing',
                detail: pm === undefined ? 'no package manager detected' : `no ${pm} install commands`,
            });
            continue;
        }
        let failure;
        for (const command of commands.commands) {
            const outcome = await runCommand(command);
            if (!outcome.ok) {
                failure = outcome;
                break;
            }
        }
        if (failure !== undefined) {
            const entry = { id: dep.id, status: 'failed' };
            if (failure.detail !== undefined) {
                entry.detail = failure.detail;
            }
            results.push(entry);
            continue;
        }
        if (await isSatisfied(dep, hw)) {
            results.push({ id: dep.id, status: 'satisfied' });
        }
        else {
            results.push({
                id: dep.id,
                status: 'failed',
                detail: 'commands finished but the probe still reports missing; re-check by hand',
            });
        }
    }
    return { ok: results.every((entry) => entry.status === 'satisfied'), results };
}
/**
 * isSatisfied runs a dep's probe. A dep with no probe is never satisfied from
 * the plugin's point of view, which is the documented degrade-to-missing rule.
 */
async function isSatisfied(dep, hw) {
    return dep.detect === undefined ? false : await dep.detect(hw);
}
//# sourceMappingURL=deps.js.map