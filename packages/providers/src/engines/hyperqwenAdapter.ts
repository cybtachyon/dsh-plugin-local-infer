/**
 * The Hyper-Qwen engine adapter. HyperQwenAdapter is the docker-compose
 * engine. `renderLaunch` renders a compose plan (the compose file, the
 * profile, and the `.env` the spec surface maps to); `deploy` runs
 * `docker compose up`; `healthCheck` polls the health URL; `stop` runs
 * `docker compose down`.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenAdapter
 */

import { EngineAdapter, formatLaunchCommand } from '../../../core/lib/index.js'
import type {
  Config,
  DeployOptions,
  DeployResult,
  EngineLaunchSignature,
  EnginePlatformConfig,
  HealthCheckOptions,
  HealthResult,
  HardwareProfile,
  LaunchPlan,
  LaunchProgress,
  LifecycleHost,
  ParameterSpec,
} from '../../../core/lib/index.js'
import { customArgEnv, envFromSpecs, nodeLifecycleHost, pollHealth } from '../adapters.ts'
import { HYPERQWEN_PARAMETERS } from './hyperqwen.ts'

/**
 * HyperQwenAdapter is the docker-compose engine. `renderLaunch` renders a
 * compose plan (the compose file, the profile, and the `.env` the spec surface
 * maps to); `deploy` runs `docker compose up`; `healthCheck` polls the health
 * URL; `stop` runs `docker compose down`.
 */
export class HyperQwenAdapter extends EngineAdapter {
  readonly id = 'hyperqwen'
  readonly supports = { docker: true, local: false }
  private readonly host: LifecycleHost

  constructor(host: LifecycleHost = nodeLifecycleHost) {
    super()
    this.host = host
  }

  parameters(): readonly ParameterSpec[] {
    return HYPERQWEN_PARAMETERS
  }

  override modelRef(_config: Config): { id: string; name: string } {
    // vLLM serves the model under the name the compose file passes, and the
    // plugin tracks no per-model data for Hyper-Qwen yet, so the engine id is
    // the stable entry the registrar publishes until that data lands.
    return { id: 'hyperqwen', name: 'Hyper-Qwen' }
  }

  override launchSignature(config: Config = {}): EngineLaunchSignature {
    // The compose host process is `docker compose ... up`, so the marker is
    // the command, not an image. The toEnv keys (SPEC, CTX, KV, ...) name the
    // .env the compose file reads, not the host process env, so they ride
    // along as the env-key element the matcher checks when a process line
    // carries env data.
    const port = this.port(config)
    const envKeys = Object.keys(envFromSpecs(HYPERQWEN_PARAMETERS, config))
    return { binary: 'docker compose', port, envKeys }
  }

  renderLaunch(config: Config, _hw: HardwareProfile): LaunchPlan {
    const port = this.port(config)
    const profile = this.profile(config)
    // The spec env and the card's Custom Arguments merge into one env map: the
    // spec keys are the .env the compose file reads, and the custom rows are
    // the user's own overrides appended after them.
    const env = { ...envFromSpecs(HYPERQWEN_PARAMETERS, config), ...customArgEnv(config) }
    const composeFile =
      typeof config.composeFile === 'string' ? config.composeFile : 'docker-compose.yml'
    return {
      engineId: this.id,
      kind: 'compose',
      env,
      composeFile,
      profile,
      port,
      healthUrl: `http://127.0.0.1:${port}/health`,
    }
  }

  async deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    _options?: DeployOptions,
  ): Promise<DeployResult> {
    // The card's docker-tag field carries the compose arguments (the profile
    // the up step selects); the deploy step applies it to the plan so the up
    // line and the card's Logs section agree.
    if (platform?.dockerTag !== undefined) {
      plan.composeArgs = platform.dockerTag
    }
    // The core formatter is the single source of the compose up line: the
    // card's Logs section prints the same string this run gets.
    const command = formatLaunchCommand(plan)
    if (command === undefined) {
      return { ok: false, detail: 'compose plan carries no command' }
    }
    // The compose up is the docker build step: the card's button reads
    // "Building..." for it.
    onProgress?.('build')
    const up = await this.host.run(command)
    if (!up.ok) {
      return { ok: false, detail: `compose up failed: ${up.detail ?? 'unknown'}` }
    }
    return { ok: true }
  }

  async healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult> {
    return pollHealth(this.host, plan, options)
  }

  async stop(plan: LaunchPlan): Promise<void> {
    // The down step brings down the containers the up step started, so it
    // runs the same compose arguments (the profile the up selected); an
    // absent composeArgs falls back to the engine's default profile.
    const composeArgs = plan.composeArgs?.split(/\s+/).filter((token) => token !== '')
    const args =
      composeArgs !== undefined && composeArgs.length > 0
        ? composeArgs.join(' ')
        : `--profile ${plan.profile ?? 'single'}`
    await this.host.run(
      `docker compose -f ${plan.composeFile ?? 'docker-compose.yml'} ${args} down`,
    )
  }

  private port(config: Config): number {
    return typeof config.port === 'number' ? config.port : 18020
  }

  private profile(config: Config): string {
    return typeof config.profile === 'string' ? config.profile : 'single'
  }
}
