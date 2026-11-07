import type { CommandOutcome } from './deps.ts'
import type { Config } from './config.ts'
import type { DebugLogger } from './debug.ts'
import type { HardwareProfile } from './hardware.ts'
import type { ParameterSpec } from './parameter.ts'
import type { SystemDep } from './deps.ts'
import type { EngineLaunchSignature } from './reserve.ts'

/**
 * BuildMode is the deploy mode an engine renders a plan for: a docker
 * container, a local source build, or a prebuilt binary install (the Strata
 * Terminal the install script places on the path). The adapter reads it from
 * the config `buildMode` field and renders the matching plan.
 */
export type BuildMode = 'docker' | 'local' | 'binary'

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
  // The user's compose arguments (the card's docker-tag field for a compose
  // engine, e.g. `--profile single`): the flags the up step runs before the
  // required `up -d`. Absent when the user leaves the field empty, so the
  // up step falls back to the engine's default profile.
  composeArgs?: string
  containerName?: string
  modelId?: string
  modelDirectory?: string
  // The model artifact the engine serves, stamped by renderLaunch from the
  // config's model field: a file name (a registry key's artifact, a directory
  // scan's .basalt name, the engine default) or a path the user typed. The
  // deploy step downloads exactly this file (its basename) and points the
  // engine's model flag at it, so the download and the launch target one
  // artifact without the deploy step re-parsing the rendered argv. Absent for
  // engines that name no single artifact file.
  modelFile?: string
  port: number
  healthUrl: string
  // The host OS the plan renders for, stamped by renderLaunch from the
  // detected HardwareProfile. The deploy step's build step reads it to pick
  // the OS-appropriate engine build steps (the Windows vcpkg route versus the
  // Linux cmake route) when the user carries no build-command override.
  os?: 'linux' | 'windows' | 'macos'
  // The rendered config file the deploy step writes before spawn: the path it
  // lands at and the content the writeFile step writes. The engine's config
  // flag points at the path. The default home for the path is the plugin
  // config directory (dshConfigCacheDirectory(), composed with a per-engine
  // subdirectory); an adapter may stamp a different path only when the engine
  // requires a specific placement. Absent for engines that carry every
  // setting in argv or env.
  configFile?: { path: string; content: string }
  // The engine process pid the stop step signals when the adapter tracks no
  // child handle for it: an engine a DSH restart re-adopted from a stored
  // launch record carries no in-memory handle, so the route stamps the record's
  // pid here and the stop step kills it through the host. Absent when the
  // stop targets nothing the record names (a fresh stop of an idle engine).
  pid?: number
}

/**
 * EnginePlatformConfig is the per-engine platform config the user adds for a
 * specific engine: where the engine platform lives locally (the checkout and
 * build location) and the git repo that overrides the engine's default
 * upstream for this config. The deploy step consumes both: it clones the fork
 * (or the default upstream) into the engine directory. `buildCommands`
 * overrides the engine's local build command (the local build mode) and
 * `dockerTag` overrides the docker image tag the docker deploy pulls (the
 * docker build mode); each rides the platform map, so an engine switch keeps
 * them.
 */
export interface EnginePlatformConfig {
  engineId: string
  engineDirectory?: string
  engineFork?: string
  buildCommands?: string
  dockerTag?: string
}

/**
 * ProcessExitInfo is the one-shot answer to a spawned process's lifetime end:
 * the exit code (null when a signal or a spawn failure ended it), the signal
 * name (null when the process exited on its own), and the spawn error message
 * when the child never ran (a missing binary). The host emits it exactly once
 * per child, from the close event or the error event, so a crash or a pkill
 * reaches the plugin's state through one seam instead of an uncaughtException.
 */
export interface ProcessExitInfo {
  code: number | null
  signal: string | null
  error?: string
}

/**
 * ProcessHandle is the handle to a spawned engine process: its pid and a kill
 * the stop step calls. A docker run and a compose up spawn a process the host
 * tracks; a local engine spawn is the process the adapter owns. `logs`, when
 * the host captures the child's stdout and stderr, is the accumulated output
 * the launch step surfaces in the card's Logs section and writes to the log
 * file. A host that does not capture streams (a container it cannot read)
 * omits it. `onExit`, when the host watches the child, registers a listener
 * fired once with the ProcessExitInfo when the child ends (a crash, a signal
 * like a pkill, or a clean stop); a listener registered after the child has
 * already ended fires immediately. A host that cannot watch (a stub, or a
 * container it cannot read) omits it. `hasExited`, when the host tracks the
 * child's exit state, reports whether the child has settled (exited, been
 * signalled, or failed to spawn): a state read a poll can check between
 * attempts, separate from the one-shot onExit listener. A handle that cannot
 * report its exit state (a stub) omits it, and a caller that cannot check
 * falls back to the full poll.
 */
export interface ProcessHandle {
  pid: number
  kill(): void
  logs?: string
  onExit?(listener: (exit: ProcessExitInfo) => void): void
  hasExited?(): boolean
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
 * RunOptions tunes a host command run: `shell` names the shell the command
 * line runs in, read from the engine OS profile (the Windows vcpkg build route
 * names pwsh.exe, because its steps set $env: variables). Absent runs
 * the host's default shell. `signal` is the card's cancel: an abort kills the
 * in-flight child (SIGINT, then SIGTERM), so a canceled Get/Launch download
 * stops instead of running on behind the card. `graceMs` overrides the 5 s
 * SIGTERM escalation window of that abort path, so a test can exercise the
 * escalation without waiting. `needsSudo` declares that the command line runs
 * sudo, stated by the caller (a hand-written link line), never parsed from
 * the command text; the host applies the sudo-prompt rule to a declared run.
 */
export interface RunOptions {
  shell?: string
  signal?: AbortSignal
  graceMs?: number
  needsSudo?: boolean
}

/**
 * LifecycleHost is the injectable execution surface an adapter drives its
 * deploy, health-check, and stop steps through. The providers ship a node
 * implementation (child_process plus fetch); the tests stub it, so no real
 * build, docker, or network run in CI. `debug`, when present, receives every
 * command the host issues (each `run` line and each `spawn` argv), so a host in
 * DSH debug mode captures the full build-to-launch sequence the plugin runs.
 */
export interface LifecycleHost {
  run(command: string, options?: RunOptions): Promise<CommandOutcome>
  /**
   * Optional: run a command line and stream each stdout/stderr chunk to
   * onOutput while it runs, so the Get step can append build output to the
   * card's Logs section as it lands. A host that cannot stream omits it,
   * and the caller falls back to run. No overall timeout: a full CUDA
   * build legitimately runs past any fixed cap, and the card prices a
   * stalled step with its own output-idle watchdog.
   */
  runStream?(
    command: string,
    onOutput: (chunk: string) => void,
    options?: RunOptions,
  ): Promise<CommandOutcome>
  spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle
  /**
   * Optional: write a file to the host, creating missing parent directories.
   * The deploy step calls it to land the rendered config file the plan's
   * `configFile` names before the spawn, so the engine's config flag points
   * at a path that exists. A host that cannot write files (a test stub)
   * omits it, and the deploy step skips the write without failing.
   */
  writeFile?(path: string, content: string): Promise<void>
  fetch(url: string): Promise<FetchResult>
  debug?: DebugLogger
}

/**
 * HealthCheckOptions tunes the poll: the interval between attempts and the
 * attempt cap. The service passes the config's healthPollMs and
 * healthMaxAttempts through; the adapter's defaults keep a bare call working.
 * `onLog` is the launch run's log sink (the same sink LaunchOptions and
 * DeployOptions carry): the health poll writes its `> GET <healthUrl>` line
 * through it once before the first request and the settled verdict after, so
 * the live run reads what the poll is waiting for. Absent (a headless poll)
 * and the poll runs without logging.
 */
export interface HealthCheckOptions {
  pollMs?: number
  maxAttempts?: number
  onLog?: CommandLogger
}

/**
 * LaunchStep is the phase of a launch the card's Launch control prices: the
 * system-dependency install (prereqs), the model and git checkout download
 * (download), the source build or image pull (build), and the health poll that
 * waits for the engine to come ready (launch). The service and the adapters
 * report the step as each phase begins, so the card's button reads the phase
 * that is actually running instead of a single "Launching..." for the whole
 * rebuild. The card times out only the launch step; the rebuild steps (prereqs,
 * download, build) run as long as they need to.
 */
/**
 * LAUNCH_STEPS is the step-name tuple the LaunchStep union derives from: the
 * one runtime home of the four phase names. The client machine mirrors the
 * tuple as its LAUNCH_PHASE_STATES (the card bundle carries no core code); the
 * ui suite pins the two sides equal so a name added on one side without the
 * other fails a test, not the button.
 */
export const LAUNCH_STEPS = ['prereqs', 'download', 'build', 'launch'] as const

/** The LaunchStep union, derived from the LAUNCH_STEPS tuple. */
export type LaunchStep = (typeof LAUNCH_STEPS)[number]

/**
 * LaunchProgress is the callback the launch flow calls as each phase begins.
 * The route threads it from the streamed launch response through the service
 * and the adapter's deploy step; a launch with no progress sink omits it.
 */
export type LaunchProgress = (step: LaunchStep) => void

/**
 * CommandLogger receives the `$ <command>` line of each mutating command the
 * deploy and stop steps run, before the child spawns, so the run's log reads
 * command first and the CLI's output after. The launch and stop run paths
 * thread their run-log sink through this seam; a caller with no run log (a
 * headless service call) passes none and the steps run as they did before.
 */
export type CommandLogger = (line: string) => void

/**
 * COMMAND_LOG_PREFIX leads the exec audit rule's command line in every run
 * log: `$ ` then the command, newline-terminated. Every exec site (the service
 * runners, the adapters' auditRun, the acquire step's echo, the Get steps'
 * extra-command emit) formats through commandLogLine, so the marker has one
 * home. The marker is also exported for the test stubs that replay a real
 * service or runner's writes.
 */
export const COMMAND_LOG_PREFIX = '$ '

/**
 * commandLogLine formats one exec audit rule line: the COMMAND_LOG_PREFIX, the
 * command, and the newline. The `$ <command>` line reaches the run's log sink
 * before the child spawns.
 */
export function commandLogLine(command: string): string {
  return `${COMMAND_LOG_PREFIX}${command}\n`
}

/**
 * URL_LOG_PREFIX leads the URL audit rule's request line in every run log:
 * `> GET ` then the URL. The health polls format through urlLogLine, so the
 * marker has one home (the exec rule's URL twin).
 */
export const URL_LOG_PREFIX = '> GET '

/**
 * urlLogLine formats one URL audit rule line: the URL_LOG_PREFIX, the URL, an
 * optional settled verdict word the poll appends after a space (`ready`,
 * `still downloading: ...`), and the newline. The bare line reaches the run's
 * log sink before the first request; the verdict line lands after the poll
 * returns.
 */
export function urlLogLine(url: string, verdict?: string): string {
  return `${URL_LOG_PREFIX}${url}${verdict === undefined ? '' : ` ${verdict}`}\n`
}

/**
 * EngineLaunchState is the phase of an engine start the health poll reports:
 * downloading (the engine is fetching its engine or model files, the health
 * endpoint is not up yet), starting (the files are in place and the engine is
 * coming up), ready (the health endpoint reports 200), and failed (the start
 * did not reach readiness). An engine that downloads before it can serve (the
 * Strata Terminal) spends a long time in downloading, so the poll reports the
 * phase instead of timing out and reading the start as broken.
 */
export type EngineLaunchState = 'downloading' | 'starting' | 'ready' | 'failed'

/**
 * HealthResult is the answer to a /health poll: whether the engine is up, the
 * HTTP status, a detail string for the UI, and the start phase the poll
 * observed (absent for an engine whose start has no download phase).
 */
export interface HealthResult {
  healthy: boolean
  status?: number
  detail?: string
  state?: EngineLaunchState
}

/**
 * DeployOptions tunes a deploy run: `allowRunDeps` is the Play/Run trust gate
 * (the card's "Allow one-click install (sudo)" checkbox). A local deploy that
 * rebuilds the engine and leaves its binary out of the path links it into
 * /usr/local/bin; the gate decides whether that sudo link runs (on) or is
 * written to the card's Logs section for the user to run (off). `autoRebuild`
 * is the card's "Auto Rebuild" checkbox: when false, the engine acquisition
 * steps (the git sync with its fetch, rebase, and conditional rebuild, the
 * docker image pull, and the Strata binary installer) are skipped and the
 * already-present checkout, image, or binary launches as-is. Absent reads as
 * true (the acquisition runs). `onLog` is the launch run's
 * log sink: a deploy that runs a mutating command (an image pull, a model
 * download) writes its `$ <command>` line through it before the child spawns,
 * so the launch's live run reads the command first. Absent (a headless
 * launch) and the deploy runs without logging them.
 */
export interface DeployOptions {
  allowRunDeps?: boolean
  autoRebuild?: boolean
  onLog?: CommandLogger
}

/**
 * DeployResult reports whether a build-or-pull succeeded, with a detail for the
 * UI. `handle` is the spawned engine process when the deploy step started one
 * locally: the service reads its accumulated `logs` after the health poll, so
 * the launch result carries the engine's output for the card's Logs section and
 * the log file, and attaches the handle's `onExit` listener to learn of a crash
 * or a pkill. A deploy that starts no process (a compose up) omits it. `logs`
 * is the deploy step's own captured output (the rebuild decision, the build
 * command, and its output) the service prepends to the engine's output, so the
 * card's Logs section shows the build a launch ran. A deploy that runs no
 * rebuild (a docker pull, a compose up) omits it.
 */
export interface DeployResult {
  ok: boolean
  detail?: string
  handle?: ProcessHandle
  logs?: string
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
  abstract readonly supports: { docker: boolean; local: boolean; binary?: boolean }
  abstract parameters(): readonly ParameterSpec[]
  abstract renderLaunch(config: Config, hw: HardwareProfile): LaunchPlan
  abstract healthCheck(plan: LaunchPlan, options?: HealthCheckOptions): Promise<HealthResult>
  abstract deploy(
    plan: LaunchPlan,
    platform?: EnginePlatformConfig,
    onProgress?: LaunchProgress,
    options?: DeployOptions,
  ): Promise<DeployResult>
  /**
   * stop signals the engine the plan names. The optional `log` is the stop
   * run's log sink: an adapter that stops through a command (compose down,
   * docker stop, a pid signal) writes its `$ <command>` line through it
   * before the child runs, so the stop's live run reads the command first.
   * An adapter that only signals a tracked handle logs nothing.
   */
  abstract stop(plan: LaunchPlan, log?: CommandLogger): Promise<void>

  /**
   * Optional: the host deps this engine's deploy step needs for a build mode,
   * declared by the adapter that knows its own toolchain. The service asks a
   * registered adapter first and falls back to the provider-registered plan
   * for the engine id when the adapter declares none.
   */
  systemDeps?(buildMode: BuildMode, hw: HardwareProfile): readonly SystemDep[]

  /**
   * Optional: the model the engine serves under a config: the id the engine
   * advertises on its OpenAI endpoint and the display name the registrar
   * publishes. The registrar's model row must match the id the engine serves,
   * so a chat turn routes to the right model. An adapter without per-model
   * data omits it, and the route falls back to the plan's model id.
   */
  modelRef?(config: Config): { id: string; name: string } | undefined

  /**
   * Optional: the model the running engine actually serves, read live from the
   * engine (a terminal query against its model endpoint) rather than derived
   * from the config. An engine that sizes and picks the model itself publishes
   * the served id this returns instead of the config-derived modelRef; it
   * returns undefined when the engine is not up, the answer cannot be read, or
   * the config names a model, and the route falls back to modelRef. The
   * register, save-sync, unregister, and summary paths await it, so it must
   * never reject.
   */
  discoverModel?(config: Config): Promise<{ id: string; name: string } | undefined>

  /**
   * Optional: the request modalities the engine serves under a config, the
   * input types the DSH model row carries. An engine whose vision control is
   * not the plain boolean flag (Strata's on|off|gpu|cpu enum, on by default)
   * declares this so the Image input follows the engine's own vocabulary; an
   * engine that declares none keeps the register step's boolean rule.
   */
  modelInput?(config: Config): string[] | undefined

  /**
   * Optional: the launch signature the engine's toArgv/toEnv produce for a
   * config: the binary (or docker image) it runs under, the port it binds,
   * and the env keys it sets. The service's OS-reserve probe matches running
   * processes against these signatures to detect a foreign local inference
   * the plugin did not launch. An adapter whose engine leaves no host
   * process omits it, and the reserve falls back to the GPU-usage rule.
   */
  launchSignature?(config?: Config): EngineLaunchSignature | undefined

  /**
   * planKey is the children-map key an adapter tracks a spawned engine
   * process under: the plan's engine id and port, the pair that identifies
   * one running engine. The base class owns the rule, so every adapter
   * tracks and stops the exact process it started.
   */
  protected planKey(plan: LaunchPlan): string {
    return `${plan.engineId}:${plan.port}`
  }
}
