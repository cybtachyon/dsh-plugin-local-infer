import type { BuildMode, EngineAdapter } from './adapter.ts';
import type { HardwareProfile } from './hardware.ts';
/**
 * DepStatus is the lifecycle state of one host dependency: satisfied, missing,
 * installing, or failed. The "Get" button stays disabled until every required
 * dep reports satisfied.
 */
export type DepStatus = 'satisfied' | 'missing' | 'installing' | 'failed';
/**
 * PackageManager is the detected host package manager the install commands are
 * keyed against. The same dep renders the right commands for the user's OS
 * through this key.
 */
export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'brew';
/**
 * PackageManagerProbes are the raw which-probe results a detection run
 * collects: which of the four package-manager binaries exist on the host, plus
 * the OS. The pure mapping below turns them into the single winner; the
 * probes are the service's job.
 */
export interface PackageManagerProbes {
    os: 'linux' | 'windows' | 'macos';
    apt: boolean;
    dnf: boolean;
    pacman: boolean;
    brew: boolean;
}
/**
 * InstallCommands is one dep's install block for one package manager: the
 * command lines, in order, and the env exports the user runs after the
 * commands finish (CUDACXX, TORCH_CUDA_ARCH_LIST). The envAfter exports are
 * per-manager, not per-dep, because the same variable points at a different
 * path on Debian (/usr/local/cuda) than on Arch (/opt/cuda).
 */
export interface InstallCommands {
    commands: readonly string[];
    envAfter?: Record<string, string>;
}
/**
 * SystemDep declares one host dependency the plugin does not own: the
 * package-manager tools, the CUDA toolkit, the NVIDIA Container Toolkit, the
 * Hugging Face CLI. `install` is keyed by the detected package manager (apt,
 * dnf, pacman, brew) so the same dep renders the right commands for the user's
 * OS. `detect` is a which/version probe; an unknown state degrades to missing
 * so the user can still copy-paste and re-check.
 */
export interface SystemDep {
    id: string;
    purpose: string;
    requiresSudo: boolean;
    detect?: (hw: HardwareProfile) => Promise<boolean>;
    install: Record<string, InstallCommands>;
}
/**
 * EngineDepPlan is the per-engine answer to "which host deps does this engine
 * need": the docker list and the local list. A docker build skips the compile
 * toolchain entirely; a local build needs it. The providers ship the plans as
 * data, so adding an engine is a data edit.
 */
export interface EngineDepPlan {
    docker: readonly SystemDep[];
    local: readonly SystemDep[];
    binary?: readonly SystemDep[];
}
/**
 * DepCheck is the per-dep answer from checkDeps: the dep and its current
 * status.
 */
export interface DepCheck {
    dep: SystemDep;
    status: DepStatus;
}
/**
 * CommandOutcome is the answer to one install command: whether it exited
 * clean and a detail the UI shows when it did not.
 */
export interface CommandOutcome {
    ok: boolean;
    detail?: string;
}
/**
 * CommandRunner runs one shell command line and reports the exit. The
 * Play/Run path takes it as a parameter, so the tests stub it and never run a
 * real sudo in CI.
 */
export type CommandRunner = (command: string) => Promise<CommandOutcome>;
/**
 * InstallResult is the outcome of the Play/Run path: overall success and the
 * per-dep status after re-running the probes.
 */
export interface InstallResult {
    ok: boolean;
    results: {
        id: string;
        status: DepStatus;
        detail?: string;
    }[];
}
/**
 * SystemDepProvisioner maps (engine, build mode, hardware) to the required host
 * deps, renders a copy/paste install string for the detected OS and package
 * manager, and runs the Play/Run path. A docker build needs only the container
 * runtime; a local build needs the compile toolchain and CUDA toolkit. The
 * service implements this interface over the pure functions below.
 */
export interface SystemDepProvisioner {
    planDeps(engine: EngineAdapter, buildMode: BuildMode, hw: HardwareProfile): readonly SystemDep[];
    checkDeps(deps: readonly SystemDep[], hw: HardwareProfile): Promise<DepCheck[]>;
    renderInstallString(deps: readonly SystemDep[], hw: HardwareProfile): string;
    runInstall(deps: readonly SystemDep[], hw: HardwareProfile, runCommand: CommandRunner): Promise<InstallResult>;
}
/**
 * detectPackageManager picks the single package manager the install commands
 * key against, from the which-probe results. macOS keys on brew. Linux tries
 * the distro-native manager in the order the plan lists them (apt, dnf,
 * pacman); a distro that ships two keeps the first. Windows has no command
 * set yet and reads as undetected, which the renderer degrades to.
 */
export declare function detectPackageManager(probes: PackageManagerProbes): PackageManager | undefined;
/**
 * planDeps is the relationship edge from engine to host deps: the deps the
 * engine's deploy step needs for the requested build mode. An adapter that
 * declares none (the Phase 5 adapters will) plans an empty list, and the
 * service falls back to the provider-registered plan for the engine id.
 */
export declare function planDeps(engine: EngineAdapter, buildMode: BuildMode, hw: HardwareProfile): readonly SystemDep[];
/**
 * checkDeps probes every dep and reports its status. A dep without a detect
 * probe reads as missing, not satisfied: an unknown state degrades to the
 * state the user can fix by copy-pasting the install string and re-checking.
 */
export declare function checkDeps(deps: readonly SystemDep[], hw: HardwareProfile): Promise<DepCheck[]>;
/**
 * renderInstallString emits the copy/paste block for the user's detected OS
 * and package manager, mirroring the qwen-ninfer header: the apt and CUDA-
 * keyring lines plus the export on Debian/Ubuntu, the pacman lines plus the
 * exports on Arch. Every dep contributes its purpose comment, its commands
 * (or a by-hand note when the detected manager has none for it), and its
 * envAfter exports. When no package manager is detected the block groups the
 * commands by manager, because the user has to pick the one for their system.
 */
export declare function renderInstallString(deps: readonly SystemDep[], hw: HardwareProfile): string;
/**
 * runInstall is the Play/Run path: it runs each missing dep's commands in
 * order through the injected runner, stops a dep at its first failed command
 * (capturing the exit detail), then re-runs the probe to confirm. A dep the
 * probe cannot confirm (no detect, or the probe still reads missing after a
 * clean run) reports failed, because the user cannot be told "installed" for
 * a state the plugin did not see.
 */
export declare function runInstall(deps: readonly SystemDep[], hw: HardwareProfile, runCommand: CommandRunner): Promise<InstallResult>;
//# sourceMappingURL=deps.d.ts.map