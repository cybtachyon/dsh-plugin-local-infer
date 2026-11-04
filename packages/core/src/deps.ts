import type { BuildMode, EngineAdapter } from './adapter.ts'
import type { HardwareProfile } from './hardware.ts'

/**
 * DepStatus is the lifecycle state of one host dependency: satisfied, missing,
 * installing, or failed. The "Get" button stays disabled until every required
 * dep reports satisfied.
 */
export type DepStatus = 'satisfied' | 'missing' | 'installing' | 'failed'

/**
 * PackageManager is the detected host package manager the install commands are
 * keyed against. The same dep renders the right commands for the user's OS
 * through this key. Windows keys on winget, the package manager that ships
 * with the OS.
 */
export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'brew' | 'winget'

/**
 * PackageManagerProbes are the raw which-probe results a detection run
 * collects: which of the package-manager binaries exist on the host, plus the
 * OS. The pure mapping below turns them into the single winner; the probes are
 * the service's job.
 */
export interface PackageManagerProbes {
  os: 'linux' | 'windows' | 'macos'
  apt: boolean
  dnf: boolean
  pacman: boolean
  brew: boolean
  winget: boolean
}

/**
 * InstallCommands is one dep's install block for one package manager: the
 * command lines, in order, and the env exports the user runs after the
 * commands finish (CUDACXX, TORCH_CUDA_ARCH_LIST). The envAfter exports are
 * per-manager, not per-dep, because the same variable points at a different
 * path on Debian (/usr/local/cuda) than on Arch (/opt/cuda).
 */
export interface InstallCommands {
  commands: readonly string[]
  envAfter?: Record<string, string>
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
  id: string
  purpose: string
  requiresSudo: boolean
  detect?: (hw: HardwareProfile) => Promise<boolean>
  install: Record<string, InstallCommands>
}

/**
 * EngineDepPlan is the per-engine answer to "which host deps does this engine
 * need": the docker list, the optional binary list, and the per-OS local
 * lists. A docker build skips the compile toolchain entirely; a local build
 * needs it. The providers ship the plans as data, so adding an engine is a
 * data edit. The local lists are per-OS, sourced from the engine OS profile's
 * deps by the providers (the Windows profile carries the winget toolchain,
 * the shared Linux profile the apt/dnf/pacman/brew toolchain); a host OS
 * reads its own list, and an OS with no dedicated list (macOS) reads the
 * Linux list.
 */
export interface EngineDepPlan {
  docker: readonly SystemDep[]
  // The prebuilt-binary install list (the Strata Terminal). Absent for engines
  // that ship no binary install path.
  binary?: readonly SystemDep[]
  // The per-OS local build-mode lists. A host OS reads its own entry; an OS
  // with no entry (macOS) reads the linux entry. Absent for engines that
  // declare their local deps through the adapter's systemDeps instead.
  local?: Partial<Record<'linux' | 'windows' | 'macos', readonly SystemDep[]>>
}

/**
 * osLabel is the friendly OS name the install string's header and the card's
 * System dependencies section show: WSL on a WSL2 kernel, Windows on Windows,
 * OSX on macOS, and Linux on every other Linux host.
 */
export function osLabel(hw: { os: 'linux' | 'windows' | 'macos'; wsl2?: boolean }): string {
  if (hw.os === 'windows') return 'Windows'
  if (hw.os === 'macos') return 'OSX'
  return hw.wsl2 === true ? 'WSL' : 'Linux'
}

/**
 * DepCheck is the per-dep answer from checkDeps: the dep and its current
 * status.
 */
export interface DepCheck {
  dep: SystemDep
  status: DepStatus
}

/**
 * CommandOutcome is the answer to one install command: whether it exited
 * clean and a detail the UI shows when it did not.
 */
export interface CommandOutcome {
  ok: boolean
  detail?: string
}

/**
 * CommandRunner runs one shell command line and reports the exit. The
 * Play/Run path takes it as a parameter, so the tests stub it and never run a
 * real sudo in CI. `needsSudo` carries the dep's sudo declaration
 * (SystemDep.requiresSudo) to the runner so it can apply the sudo-prompt rule;
 * the need is declared in data, never parsed from the command text.
 */
export type CommandRunner = (
  command: string,
  options?: { needsSudo?: boolean },
) => Promise<CommandOutcome>

/**
 * InstallResult is the outcome of the Play/Run path: overall success and the
 * per-dep status after re-running the probes.
 */
export interface InstallResult {
  ok: boolean
  results: { id: string; status: DepStatus; detail?: string }[]
}

/**
 * SystemDepProvisioner maps (engine, build mode, hardware) to the required host
 * deps, renders a copy/paste install string for the detected OS and package
 * manager, and runs the Play/Run path. A docker build needs only the container
 * runtime; a local build needs the compile toolchain and CUDA toolkit. The
 * service implements this interface over the pure functions below.
 */
export interface SystemDepProvisioner {
  planDeps(engine: EngineAdapter, buildMode: BuildMode, hw: HardwareProfile): readonly SystemDep[]
  checkDeps(deps: readonly SystemDep[], hw: HardwareProfile): Promise<DepCheck[]>
  renderInstallString(deps: readonly SystemDep[], hw: HardwareProfile): string
  runInstall(deps: readonly SystemDep[], hw: HardwareProfile, runCommand: CommandRunner): Promise<InstallResult>
}

/**
 * detectPackageManager picks the single package manager the install commands
 * key against, from the which-probe results. macOS keys on brew. Windows keys
 * on winget, the package manager that ships with the OS. Linux tries the
 * distro-native manager in the order the plan lists them (apt, dnf, pacman);
 * a distro that ships two keeps the first. A host whose manager probe reads
 * absent reads as undetected, which the renderer degrades to.
 */
export function detectPackageManager(probes: PackageManagerProbes): PackageManager | undefined {
  if (probes.os === 'macos') {
    return probes.brew ? 'brew' : undefined
  }
  if (probes.os === 'windows') {
    return probes.winget ? 'winget' : undefined
  }
  if (probes.os === 'linux') {
    if (probes.apt) return 'apt'
    if (probes.dnf) return 'dnf'
    if (probes.pacman) return 'pacman'
  }
  return undefined
}

/**
 * planDeps is the relationship edge from engine to host deps: the deps the
 * engine's deploy step needs for the requested build mode. An adapter that
 * declares none (the Phase 5 adapters will) plans an empty list, and the
 * service falls back to the provider-registered plan for the engine id.
 */
export function planDeps(
  engine: EngineAdapter,
  buildMode: BuildMode,
  hw: HardwareProfile,
): readonly SystemDep[] {
  return engine.systemDeps?.(buildMode, hw) ?? []
}

/**
 * checkDeps probes every dep and reports its status. A dep without a detect
 * probe reads as missing, not satisfied: an unknown state degrades to the
 * state the user can fix by copy-pasting the install string and re-checking.
 */
export async function checkDeps(
  deps: readonly SystemDep[],
  hw: HardwareProfile,
): Promise<DepCheck[]> {
  const checks: DepCheck[] = []
  for (const dep of deps) {
    const satisfied = dep.detect === undefined ? false : await dep.detect(hw)
    checks.push({ dep, status: satisfied ? 'satisfied' : 'missing' })
  }
  return checks
}

/**
 * The manager order the unknown-package-manager rendering groups its blocks
 * in. It is the order the plan lists them, so the block the user's host
 * would have picked sits at the top.
 */
const MANAGER_ORDER: readonly PackageManager[] = ['apt', 'dnf', 'pacman', 'brew', 'winget']

/**
 * renderInstallString emits the copy/paste block for the user's detected OS
 * and package manager, mirroring the qwen-ninfer header: the apt and CUDA-
 * keyring lines plus the export on Debian/Ubuntu, the pacman lines plus the
 * exports on Arch. Every dep contributes its purpose comment, its commands
 * (or a by-hand note when the detected manager has none for it), and its
 * envAfter exports. When no package manager is detected the block groups the
 * commands by manager, because the user has to pick the one for their system.
 */
export function renderInstallString(deps: readonly SystemDep[], hw: HardwareProfile): string {
  const pm = hw.packageManager
  const lines: string[] = []
  lines.push(`# System dependencies on ${osLabel(hw)}`)
  if (pm === undefined) {
    lines.push('# No package manager detected; blocks are grouped by manager.')
  } else {
    lines.push(`# Package manager: ${pm}`)
  }
  for (const dep of deps) {
    lines.push(`# ${dep.id}: ${dep.purpose}`)
    if (pm === undefined) {
      for (const manager of MANAGER_ORDER) {
        const commands = dep.install[manager]
        if (commands === undefined) continue
        lines.push(`# --- ${manager} ---`)
        for (const command of commands.commands) {
          lines.push(command)
        }
        appendExports(lines, commands.envAfter)
      }
      continue
    }
    const commands = dep.install[pm]
    if (commands === undefined || commands.commands.length === 0) {
      lines.push(`# no ${pm} install commands for ${dep.id}; install it by hand`)
      continue
    }
    for (const command of commands.commands) {
      lines.push(command)
    }
    appendExports(lines, commands.envAfter)
  }
  return lines.join('\n')
}

/**
 * appendExports writes the post-install env exports, one line per variable,
 * in the object's key order so the block is deterministic.
 */
function appendExports(lines: string[], envAfter: Record<string, string> | undefined): void {
  if (envAfter === undefined) return
  for (const [key, value] of Object.entries(envAfter)) {
    lines.push(`export ${key}=${value}`)
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
export async function runInstall(
  deps: readonly SystemDep[],
  hw: HardwareProfile,
  runCommand: CommandRunner,
): Promise<InstallResult> {
  const pm = hw.packageManager
  const results: InstallResult['results'] = []
  for (const dep of deps) {
    if (await isSatisfied(dep, hw)) {
      results.push({ id: dep.id, status: 'satisfied' })
      continue
    }
    const commands = pm === undefined ? undefined : dep.install[pm]
    if (commands === undefined || commands.commands.length === 0) {
      results.push({
        id: dep.id,
        status: 'missing',
        detail: pm === undefined ? 'no package manager detected' : `no ${pm} install commands`,
      })
      continue
    }
    let failure: CommandOutcome | undefined
    for (const command of commands.commands) {
      const outcome = await runCommand(command, { needsSudo: dep.requiresSudo })
      if (!outcome.ok) {
        failure = outcome
        break
      }
    }
    if (failure !== undefined) {
      const entry: InstallResult['results'][number] = { id: dep.id, status: 'failed' }
      if (failure.detail !== undefined) {
        entry.detail = failure.detail
      }
      results.push(entry)
      continue
    }
    if (await isSatisfied(dep, hw)) {
      results.push({ id: dep.id, status: 'satisfied' })
    } else {
      results.push({
        id: dep.id,
        status: 'failed',
        detail: 'commands finished but the probe still reports missing; re-check by hand',
      })
    }
  }
  return { ok: results.every((entry) => entry.status === 'satisfied'), results }
}

/**
 * isSatisfied runs a dep's probe. A dep with no probe is never satisfied from
 * the plugin's point of view, which is the documented degrade-to-missing rule.
 */
async function isSatisfied(dep: SystemDep, hw: HardwareProfile): Promise<boolean> {
  return dep.detect === undefined ? false : await dep.detect(hw)
}
