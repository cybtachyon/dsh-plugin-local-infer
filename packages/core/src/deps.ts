import type { EngineAdapter } from './adapter.ts'
import type { HardwareProfile } from './hardware.ts'

/**
 * DepStatus is the lifecycle state of one host dependency: satisfied, missing,
 * installing, or failed. The "Get" button stays disabled until every required
 * dep reports satisfied.
 */
export type DepStatus = 'satisfied' | 'missing' | 'installing' | 'failed'

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
  install: Record<string, readonly string[]>
  envAfter?: Record<string, string>
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
 * InstallResult is the outcome of the Play/Run path: overall success and the
 * per-dep status after re-running checkDeps.
 */
export interface InstallResult {
  ok: boolean
  results: { id: string; status: DepStatus; detail?: string }[]
}

/**
 * SystemDepProvisioner maps (engine, build mode, hardware) to the required host
 * deps, renders a copy/paste install string for the detected OS and package
 * manager, and runs the Play/Run path. A docker build needs only the container
 * runtime; a local build needs the compile toolchain and CUDA toolkit.
 */
export interface SystemDepProvisioner {
  planDeps(engine: EngineAdapter, buildMode: 'docker' | 'local', hw: HardwareProfile): SystemDep[]
  checkDeps(deps: SystemDep[], hw: HardwareProfile): Promise<DepCheck[]>
  renderInstallString(deps: SystemDep[], hw: HardwareProfile): string
  runInstall(deps: SystemDep[], hw: HardwareProfile): Promise<InstallResult>
}
