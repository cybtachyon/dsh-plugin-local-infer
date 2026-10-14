import type { CommandOutcome } from './deps.ts'
import type { Config } from './config.ts'
import type { HardwareProfile } from './hardware.ts'
import type { ParameterSpec } from './parameter.ts'
import type { SystemDep } from './deps.ts'

/**
 * LaunchPlan is the engine-neutral result of rendering a config: how to start
 * the engine (a local process, a docker container, or a compose file), the
 * port it serves on, and the URL to poll for health. The `engineId` stamps the
 * adapter that rendered it, so the service routes launch, stop, and register
 * to the right adapter without a second lookup. `profile` names the compose
 * profile for a compose plan; `containerName` names the docker container the
 * stop step targets.
 */
export interface LaunchPlan {
  engineId: string
  kind: 'process' | 'docker' | 'compose'
  argv?: string[]
  env?: Record<string, string>
  composeFile?: string
  profile?: string
  containerName?: string
  modelId?: string
  modelDirectory?: string
  port: number
  healthUrl: string
}

/**
 * EnginePlatformConfig is the per-engine platform config the user adds for a
 * specific engine: where the engine platform lives locally (the checkout and
 * build location) and the git repo that overrides the engine's default
 * upstream for this config. The deploy step consumes both: it clones the fork
 * (or the default upstream) into the engine directory.
 */
export interface EnginePlatformConfig {
  engineId: string
  engineDirectory?: string
  engineFork?: string
}

/**
 * ProcessHandle is the handle to a spawned engine process: its pid and a kill
 * the stop step calls. A docker run and a compose up spawn a process the host
 * tracks; a local engine spawn is the process the adapter owns.
 */
export interface ProcessHandle {
  pid: number
  kill(): void
}

/**
 * FetchResult is the answer to a health poll: the HTTP status and whether it
 * read as a success. A 200 is the healthy signal the launcher mirrors.
 */
export interface FetchResult {
  status: number
  ok: boolean
}

/**
 * LifecycleHost is the injectable execution surface an adapter drives its
 * deploy, health-check, and stop steps through. The providers ship a node
 * implementation (child_process plus fetch); the tests stub it, so no real
 * build, docker, or network run in CI.
 */
export interface LifecycleHost {
  run(command: string): Promise<CommandOutcome>
  spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle
  fetch(url: string): Promise<FetchResult>
}

/**
 * HealthCheckOptions tunes the poll: the interval between attempts and the
 * attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through; the adapter's defaults keep a bare call working.
 */
export interface HealthCheckOptions {
  pollMs?: number
  maxAttempts?: number
}

/**
 * HealthResult is the answer to a /health poll: whether the engine is up, the
 * HTTP status, and a detail string for the UI.
 */
export interface HealthResult {
  healthy: boolean
  status?: number
  detail?: string
}

/**
 * DeployResult reports whether a build-or-pull succeeded, with a detail for the
 * UI.
 */
export interface DeployResult {
  ok: boolean
  detail?: string
}

/**
 * EngineAdapter is the abstract base one subclass implements per engine. It
 * owns the engine's parameter surface and turns a config into a launch plan,
 * deploys it, health-checks it, and stops it. NInfer is the canonical adapter
 * that supports both docker and local; the others follow the same shape.
 * `deploy` takes the platform config so it clones the fork into the engine
 * directory; `healthCheck` takes poll options so the service prices the poll
 * from the config.
 */
export abstract class EngineAdapter {
  abstract readonly id: string
  abstract readonly supports: { docker: boolean; local: boolean }
  abstract parameters(): readonly ParameterSpec[]
  abstract renderLaunch(config: Config, hw: HardwareProfile): LaunchPlan
  abstract healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>
  abstract deploy(plan: LaunchPlan, platform?: EnginePlatformConfig): Promise<DeployResult>
  abstract stop(plan: LaunchPlan): Promise<void>

  /**
   * Optional: the host deps this engine's deploy step needs for a build mode,
   * declared by the adapter that knows its own toolchain. The service asks a
   * registered adapter first and falls back to the provider-registered plan
   * for the engine id when the adapter declares none.
   */
  systemDeps?(buildMode: 'docker' | 'local', hw: HardwareProfile): readonly SystemDep[]
}
