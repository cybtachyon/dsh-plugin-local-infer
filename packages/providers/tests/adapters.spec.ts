import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createNodeLifecycleHost,
  customArgEnv,
  customArgFlags,
  envFromSpecs,
  flagsFromSpecs,
  nodeLifecycleHost,
  pollHealth,
} from '../src/adapters.ts'
import { HyperQwenAdapter } from '../src/engines/hyperqwenAdapter.ts'
import { InfernixAdapter } from '../src/engines/infernixAdapter.ts'
import { LLAMACPP_DOCKER_IMAGE, LlamaCppAdapter } from '../src/engines/llamacppAdapter.ts'
import { NINFER_DOCKER_IMAGE, NINFER_MODEL_ARTIFACTS, NInferAdapter } from '../src/engines/ninferAdapter.ts'
import {
  STRATA_DOCKER_IMAGE,
  StrataAdapter,
  strataPreReadyState,
  strataServedModelId,
} from '../src/engines/strataAdapter.ts'
import { HYPERQWEN_PARAMETERS } from '../src/engines/hyperqwen.ts'
import { INFERNIX_MODEL_ARTIFACTS } from '../src/engines/infernix.ts'
import { LLAMACPP_PARAMETERS } from '../src/engines/llamacpp.ts'
import { NINFER_PARAMETERS } from '../src/engines/ninfer.ts'
import type {
  CommandOutcome,
  FetchResult,
  HardwareProfile,
  LaunchPlan,
  LifecycleHost,
  ProcessExitInfo,
  ProcessHandle,
  RunOptions,
} from '../../core/lib/index.js'

const HW: HardwareProfile = { dockerAvailable: true, wsl2: false, os: 'linux', cpuThreads: 8 }

/**
 * A stub LifecycleHost that records every run, spawn, and fetch call so the
 * adapter steps can be asserted on without a real build, docker, or network.
 * `fetchSequence` feeds a per-call status list (shifted off per poll); an
 * exhausted sequence falls back to the constant `fetchStatus`.
 */
function stubHost() {
  const state = {
    run: [] as string[],
    // The shell option each run/runStream call carried (the engine OS
    // profile's shell, e.g. powershell.exe for the Windows vcpkg route);
    // undefined when the call kept the host's default shell.
    runShells: [] as (string | undefined)[],
    spawn: [] as { argv: string[]; env: Record<string, string>; cwd?: string }[],
    fetch: [] as string[],
    killed: [] as number[],
    exits: [] as ((exit: ProcessExitInfo) => void)[],
    fetchStatus: 200,
    fetchSequence: [] as number[],
    runOk: true,
    // Per-command output the streaming surface feeds: a command substring maps
    // to the stdout the command prints, so a test prices a probe (the behind-
    // check count, the dirty status) without a real git repo.
    runOutput: {} as Record<string, string>,
  }
  const host: LifecycleHost = {
    async run(command: string, options?: RunOptions): Promise<CommandOutcome> {
      state.run.push(command)
      state.runShells.push(options?.shell)
      return state.runOk ? { ok: true } : { ok: false, detail: 'run failed' }
    },
    async runStream(
      command: string,
      onOutput: (chunk: string) => void,
      options?: RunOptions,
    ): Promise<CommandOutcome> {
      state.run.push(command)
      state.runShells.push(options?.shell)
      const output =
        Object.entries(state.runOutput).find(([key]) => command.includes(key))?.[1] ?? ''
      if (output !== '') onOutput(output)
      return state.runOk ? { ok: true } : { ok: false, detail: 'run failed' }
    },
    spawn(argv: readonly string[], env: Record<string, string>, cwd?: string): ProcessHandle {
      state.spawn.push({ argv: [...argv], env: { ...env }, cwd })
      return {
        pid: 1234,
        kill: (): void => {
          state.killed.push(1234)
        },
        // The test drives the child's death by firing these listeners, the
        // same seam the live host's close/error events reach.
        onExit: (listener: (exit: ProcessExitInfo) => void): void => {
          state.exits.push(listener)
        },
      }
    },
    async fetch(url: string): Promise<FetchResult> {
      state.fetch.push(url)
      const status =
        state.fetchSequence.length > 0 ? (state.fetchSequence.shift() as number) : state.fetchStatus
      return { status, ok: status === 200 }
    },
  }
  return { host, state }
}

/**
 * symlinkHost is a stub LifecycleHost that prices the rebuild's symlink step:
 * the checkout reads as behind (the rev-list probe prints a non-zero count),
 * the engine binary reads as off the path (the command -v probe fails), and
 * every other command (the git sync, the build, the sudo link) succeeds. Every
 * command lands in runLog, so a test asserts on the sudo link that ran (the
 * gate on) or did not (the gate off).
 */
function symlinkHost() {
  const runLog: string[] = []
  const host: LifecycleHost = {
    async run(command: string): Promise<CommandOutcome> {
      runLog.push(command)
      if (command.startsWith('command -v')) return { ok: false }
      return { ok: true }
    },
    async runStream(command: string, onOutput: (chunk: string) => void): Promise<CommandOutcome> {
      runLog.push(command)
      if (command.includes('rev-list')) onOutput('3')
      return { ok: true }
    },
    spawn(): ProcessHandle {
      return { pid: 1, kill: () => {} }
    },
    async fetch(): Promise<FetchResult> {
      return { status: 200, ok: true }
    },
  }
  return { host, runLog }
}

/**
 * onceExit awaits the handle's one-shot exit report through the onExit seam,
 * the contract the live node host fulfills from the child's close/error events.
 */
function onceExit(handle: ProcessHandle): Promise<ProcessExitInfo> {
  return new Promise((resolve, reject) => {
    if (handle.onExit === undefined) {
      reject(new Error('handle exposes no onExit seam'))
      return
    }
    handle.onExit(resolve)
  })
}

describe('NInferAdapter.renderLaunch', () => {
  it('renders a local process plan with the model path and spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', kvDtype: 'int8', maxContext: 32768, port: 18020, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('ninfer')
    expect(plan.port).toBe(18020)
    expect(plan.healthUrl).toBe('http://127.0.0.1:18020/health')
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.modelDirectory).toBe('/models')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('ninfer-serve')
    // The process plan joins the model dir with the host separator.
    expect(argv[1]).toBe(join('/models', 'qwen3_8_27b_nvfp4.ninfer'))
    expect(argv).toContain('--port')
    expect(argv).toContain('18020')
    expect(argv).toContain('--kv-dtype')
    expect(argv).toContain('int8')
    expect(argv).toContain('--max-context')
    expect(argv).toContain('32768')
  })

  it('renders a docker plan with the ghcr image, a named container, and the spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3-27b',
        buildMode: 'docker',
        kvDtype: 'int8',
        port: 18020,
        modelDirectory: '/models',
      },
      HW,
    )
    expect(plan.kind).toBe('docker')
    expect(plan.containerName).toBe('ninfer-18020')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv[1]).toBe('run')
    expect(argv).toContain(NINFER_DOCKER_IMAGE)
    expect(argv).toContain('serve')
    expect(argv).toContain('--kv-dtype')
  })

  it('defaults to the 27B artifact when the config names no model', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch({ port: 18020 }, HW)
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.argv?.[1]).toBe(NINFER_MODEL_ARTIFACTS['qwen3-27b']!.file)
  })

  it('appends the card custom args to the process argv after the spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        port: 18020,
        customArgs: [
          { key: '--flash-attn', value: '1' },
          { key: '--verbose' },
        ],
      },
      HW,
    )
    const argv = plan.argv ?? []
    // The custom rows land after the spec flags: a valued row is a flag pair,
    // a bare row is a lone flag.
    const flagIndex = argv.indexOf('--flash-attn')
    expect(flagIndex).toBeGreaterThan(-1)
    expect(argv[flagIndex + 1]).toBe('1')
    expect(argv).toContain('--verbose')
  })

  it('appends the card custom args to the docker argv after the spec flags', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        buildMode: 'docker',
        port: 18020,
        customArgs: [{ key: '--flash-attn', value: '1' }],
      },
      HW,
    )
    const argv = plan.argv ?? []
    const flagIndex = argv.indexOf('--flash-attn')
    expect(flagIndex).toBeGreaterThan(-1)
    expect(argv[flagIndex + 1]).toBe('1')
  })

  it('launches a directory-scanned .ninfer file as-is', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
        modelDirectory: '/models',
        port: 18020,
      },
      HW,
    )
    expect(plan.modelId).toBe('qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer')
    expect(plan.argv?.[1]).toBe(join('/models', 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer'))
  })
})

describe('NInferAdapter.deploy', () => {
  it('builds in the engine directory, downloads the model, and spawns the engine', async () => {
    const { host, state } = stubHost()
    // The checkout is behind the fork's master, so the conditional rebuild
    // rebases it (checkout + rebase + clean) and runs the build steps.
    state.runOutput['rev-list'] = '3'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
    expect(result.ok).toBe(true)
    // The conditional rebuild prices the checkout against the fork (added as
    // the named fork remote), rebases it because it is behind, cleans the tree,
    // and runs the build steps before the model download and the spawn.
    expect(state.run[0]).toContain('git -C /src/ninfer rev-parse --is-inside-work-tree')
    expect(state.run).toContain('git -C /src/ninfer remote add dsh-fork https://github.com/iamwavecut/ninfer-all')
    expect(state.run).toContain('git -C /src/ninfer fetch dsh-fork || true')
    expect(state.run.some((c) => c.includes('git -C /src/ninfer rebase dsh-fork/master'))).toBe(true)
    expect(state.run).toContain('git -C /src/ninfer clean -fxd')
    expect(state.run.some((c) => c.includes('cmake -S /src/ninfer -B /src/ninfer/build'))).toBe(true)
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.run.some((c) => c.includes('--local-dir /models'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/ninfer')
    // The rebuild decision, the build command, and its output ride the result
    // logs the service threads to the card's Logs section.
    expect(result.logs).toContain('is behind dsh-fork/master')
    expect(result.logs).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('resolves a relative launch path against the engine directory', async () => {
    const { host, state } = stubHost()
    state.runOutput['rev-list'] = '0'
    const adapter = new NInferAdapter(host)
    // A relative launch path (the NInfer Windows build tree) is joined against
    // the engine directory, so the spawn resolves an absolute path.
    const relativeBinary = join('build-windows', 'apps', 'Release', 'ninfer-serve.exe')
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: [relativeBinary, '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
    })
    expect(result.ok).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.argv[0]).toBe(join('/src/ninfer', relativeBinary))
    expect(state.spawn[0]?.cwd).toBe('/src/ninfer')
  })

  it('leaves a bare launch name for the path', async () => {
    const { host, state } = stubHost()
    state.runOutput['rev-list'] = '0'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
    })
    expect(result.ok).toBe(true)
    expect(state.spawn).toHaveLength(1)
    // A bare name (no path separator) resolves against the path, not the
    // engine directory, so it is left as-is.
    expect(state.spawn[0]?.argv[0]).toBe('ninfer-serve')
  })

  it('runs the Windows build steps in the profile shell when the plan names a Windows host', async () => {
    const { host, state } = stubHost()
    // The checkout is behind, so the conditional rebuild runs the build steps.
    state.runOutput['rev-list'] = '3'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: [join('build-windows', 'apps', 'Release', 'ninfer-serve.exe'), '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
      os: 'windows',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
    })
    expect(result.ok).toBe(true)
    // The vcpkg build step runs in the profile's powershell.exe shell; the git
    // sync commands keep the host's default shell.
    const vcpkgIndex = state.run.findIndex((command) => command.includes('vcpkg install'))
    expect(vcpkgIndex).toBeGreaterThan(-1)
    expect(state.runShells[vcpkgIndex]).toBe('powershell.exe')
    const gitIndex = state.run.findIndex((command) => command.includes('rev-parse'))
    expect(state.runShells[gitIndex]).toBeUndefined()
  })

  it('skips the rebuild when the checkout is up to date with the remote', async () => {
    const { host, state } = stubHost()
    // The checkout is not behind (the rev-list count reads as 0), so the
    // conditional rebuild skips the rebase and the build steps.
    state.runOutput['rev-list'] = '0'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
    expect(result.ok).toBe(true)
    // No rebase, no clean, and no build when the checkout is current.
    expect(state.run).not.toContain('git -C /src/ninfer clean -fxd')
    expect(state.run.some((c) => c.includes('cmake -S /src/ninfer -B /src/ninfer/build'))).toBe(false)
    // The model download still runs, and the decision is logged.
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(result.logs).toContain('is up to date with dsh-fork/master')
  })

  it('skips the rebuild when the checkout has local changes', async () => {
    const { host, state } = stubHost()
    // A dirty checkout (the status probe prints a changed file) aborts the
    // rebase and the build, so the user's work is never rebased away.
    state.runOutput['status --short'] = ' M src/main.cpp'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'ninfer',
      engineDirectory: '/src/ninfer',
      engineFork: 'https://github.com/iamwavecut/ninfer-all',
    })
    expect(result.ok).toBe(true)
    expect(state.run).not.toContain('git -C /src/ninfer rebase dsh-fork/master')
    expect(state.run).not.toContain('cmake -S /src/ninfer -B /src/ninfer/build')
    expect(result.logs).toContain('has local changes')
  })

  it('skips the git sync entirely when autoRebuild is off', async () => {
    const { host, state } = stubHost()
    // The checkout is behind (the rev-list count reads as 3), but the Auto
    // Rebuild checkbox is off, so the git sync (fetch, rebase, rebuild) is
    // skipped and the checkout launches as-is.
    state.runOutput['rev-list'] = '3'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(
      plan,
      { engineId: 'ninfer', engineDirectory: '/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
      undefined,
      { autoRebuild: false },
    )
    expect(result.ok).toBe(true)
    // No git sync commands ran: no checkout probe, no fetch, no rebase, no
    // clean, and no build.
    expect(state.run.some((c) => c.includes('git -C /src/ninfer rev-parse --is-inside-work-tree'))).toBe(false)
    expect(state.run.some((c) => c.includes('git -C /src/ninfer'))).toBe(false)
    expect(state.run.some((c) => c.includes('cmake -S /src/ninfer'))).toBe(false)
    // The model download still runs, and the engine spawns from the checkout.
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/ninfer')
  })

  it('links a rebuilt binary into /usr/local/bin when the trust gate is on', async () => {
    const { host, runLog } = symlinkHost()
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const adapter = new NInferAdapter(host)
    // The checkout is behind, the binary is off the path, and the trust gate is
    // on, so the rebuild runs the sudo link into /usr/local/bin.
    const result = await adapter.deploy(
      plan,
      { engineId: 'ninfer', engineDirectory: '/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
      undefined,
      { allowRunDeps: true },
    )
    expect(result.ok).toBe(true)
    expect(runLog).toContain('sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve')
  })

  it('writes the symlink command to the logs when the trust gate is off', async () => {
    const { host, runLog } = symlinkHost()
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const adapter = new NInferAdapter(host)
    // The checkout is behind, the binary is off the path, and the trust gate is
    // off, so the symlink command is written to the logs for the user to run.
    const result = await adapter.deploy(
      plan,
      { engineId: 'ninfer', engineDirectory: '/src/ninfer', engineFork: 'https://github.com/iamwavecut/ninfer-all' },
      undefined,
      { allowRunDeps: false },
    )
    expect(result.ok).toBe(true)
    expect(result.logs).toContain(
      'sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve',
    )
    expect(result.logs).toContain('must be on the path to launch')
    // The sudo link did not run when the gate is off.
    expect(runLog).not.toContain('sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve')
  })

  it('reports the download and build phases through the progress sink', async () => {
    const { host, state } = stubHost()
    // The checkout is behind, so the conditional rebuild runs the build steps
    // and the "build" phase is reported.
    state.runOutput['rev-list'] = '3'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const steps: string[] = []
    const result = await adapter.deploy(
      plan,
      {
        engineId: 'ninfer',
        engineDirectory: '/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
      },
      (step) => {
        steps.push(step)
      },
    )
    expect(result.ok).toBe(true)
    // The git sync and the model download read as download; the build steps
    // read as build, in the order the deploy runs them.
    expect(steps).toEqual(['download', 'build', 'download', 'download'])
  })

  it('reports the build phase before the build command runs', async () => {
    const { host, state } = stubHost()
    // The checkout is behind, so the conditional rebuild runs the build steps.
    state.runOutput['rev-list'] = '3'
    // An ordered log of the progress events and the build command run, so the
    // test reads the "build" phase landing before the build command starts.
    const order: string[] = []
    const progress = (step: string): void => {
      order.push(step)
    }
    const originalRunStream = host.runStream
    host.runStream = async (command: string, onOutput: (chunk: string) => void) => {
      if (command.includes('cmake')) {
        order.push('build-command')
      }
      return originalRunStream?.(command, onOutput)
    }
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(
      plan,
      {
        engineId: 'ninfer',
        engineDirectory: '/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
      },
      progress,
    )
    expect(result.ok).toBe(true)
    // The "build" phase is reported the moment the build steps start, so it
    // lands before the build command runs, not after it completes.
    const buildPhase = order.indexOf('build')
    const buildCommand = order.indexOf('build-command')
    expect(buildPhase).toBeGreaterThanOrEqual(0)
    expect(buildCommand).toBeGreaterThanOrEqual(0)
    expect(buildPhase).toBeLessThan(buildCommand)
  })

  it('runs the user build command from the platform config', async () => {
    const { host, state } = stubHost()
    // The checkout is behind, so the conditional rebuild runs the build steps.
    state.runOutput['rev-list'] = '3'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(
      plan,
      {
        engineId: 'ninfer',
        engineDirectory: '/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
        // The user's local build command overrides the engine default.
        buildCommands:
          'cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build',
      },
      () => {},
    )
    expect(result.ok).toBe(true)
    // The user command runs in the checkout, wrapped with a cd into the dir.
    expect(state.run.some((command) => command.includes('cd /src/ninfer && cmake -S . -B build'))).toBe(
      true,
    )
    // The engine default build step is not run.
    expect(state.run.some((command) => command.includes('cmake -S /src/ninfer -B /src/ninfer/build'))).toBe(
      false,
    )
  })

  it('reports no build phase when the checkout is up to date', async () => {
    const { host, state } = stubHost()
    // The checkout is not behind, so the conditional rebuild skips the build
    // steps and no "build" phase is reported.
    state.runOutput['rev-list'] = '0'
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const steps: string[] = []
    const result = await adapter.deploy(
      plan,
      {
        engineId: 'ninfer',
        engineDirectory: '/src/ninfer',
        engineFork: 'https://github.com/iamwavecut/ninfer-all',
      },
      (step) => {
        steps.push(step)
      },
    )
    expect(result.ok).toBe(true)
    // Only the download phases (the git sync and the model download); no build.
    expect(steps).toEqual(['download', 'download', 'download'])
  })

  it('reports the docker pull as the build phase', async () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'docker',
      argv: ['docker', 'run', 'ghcr.io/iamwavecut/ninfer-all'],
      env: {},
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const steps: string[] = []
    const result = await adapter.deploy(plan, undefined, (step) => {
      steps.push(step)
    })
    expect(result.ok).toBe(true)
    expect(steps).toEqual(['build'])
  })

  it('skips the clone and build when no platform config is stored', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // Only the model download runs; no clone or build without an engine dir.
    expect(state.run).toHaveLength(1)
    expect(state.run[0]).toContain('hf download')
  })

  it('rewrites an HF chat-template reference to the local file the engine reads', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: [
        'ninfer-serve',
        '/models/x.ninfer',
        '--chat-template',
        'froggeric/Qwen-Fixed-Chat-Templates',
      ],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // The deploy step probes for the local template (the default stub reads it
    // as present, so the download is skipped) and rewrites the flag to the
    // local path the engine reads.
    expect(state.run).toContain(`[ -f ${join('/models', 'chat_template.jinja')} ]`)
    expect(state.spawn[0]?.argv).toContain(join('/models', 'chat_template.jinja'))
    expect(state.spawn[0]?.argv).not.toContain('froggeric/Qwen-Fixed-Chat-Templates')
  })

  it('downloads an absent HF chat template into the model directory before the spawn', async () => {
    // A host whose probe reads the template as absent (the file is not on
    // disk) and whose download succeeds, so the spawn carries the local path.
    const runLog: string[] = []
    const host: LifecycleHost = {
      async run(command: string): Promise<CommandOutcome> {
        runLog.push(command)
        // The existence probe reads as absent (the file is not on disk), so
        // the download runs; every other command (the download itself) is ok.
        if (command.startsWith('[ -f')) return { ok: false }
        return { ok: true }
      },
      spawn(): ProcessHandle {
        return { pid: 1, kill: () => {} }
      },
      async fetch(): Promise<FetchResult> {
        return { status: 200, ok: true }
      },
    }
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: [
        'ninfer-serve',
        '/models/x.ninfer',
        '--chat-template',
        'froggeric/Qwen-Fixed-Chat-Templates',
      ],
      env: {},
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(runLog).toContain(`[ -f ${join('/models', 'chat_template.jinja')} ]`)
    expect(runLog).toContain(
      'hf download froggeric/Qwen-Fixed-Chat-Templates chat_template.jinja --local-dir /models',
    )
  })

  it('leaves a local chat-template path untouched', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/x.ninfer', '--chat-template', '/tmp/qwen.jinja'],
      env: {},
      modelDirectory: '/models',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // An absolute path is already local, so no probe or download runs and the
    // flag keeps its value.
    expect(state.run).not.toContain('[ -f /tmp/qwen.jinja ]')
    expect(state.spawn[0]?.argv).toContain('/tmp/qwen.jinja')
  })

  it('pulls the image and spawns the container for a docker plan', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'docker',
      argv: ['docker', 'run', NINFER_DOCKER_IMAGE, 'serve', 'x.ninfer'],
      env: {},
      containerName: 'ninfer-18020',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${NINFER_DOCKER_IMAGE}`)
    expect(state.spawn).toHaveLength(1)
  })

  it('reports a failed build as not-ok with the detail', async () => {
    const { host, state } = stubHost()
    // The checkout is behind (so the build runs), and only the build step fails.
    state.runOutput['rev-list'] = '3'
    const buildHost: LifecycleHost = {
      ...host,
      async runStream(command: string, onOutput: (chunk: string) => void): Promise<CommandOutcome> {
        if (command.includes('cmake')) return { ok: false, detail: 'build failed' }
        return host.runStream(command, onOutput)
      },
    }
    const adapter = new NInferAdapter(buildHost)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      modelId: 'qwen3-27b',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan, { engineId: 'ninfer', engineDirectory: '/src/ninfer' })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('build failed')
  })

  it('treats a compose plan as a no-op and skips the download when no artifact is named', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    // A compose plan is a no-op for a process/docker engine.
    const compose: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'compose',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    expect(await adapter.deploy(compose)).toEqual({ ok: true })
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(0)
    // A process plan that names no modelId skips the model download.
    const bare: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', 'x.ninfer'],
      env: {},
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(bare)
    expect(result.ok).toBe(true)
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(1)
  })
})

describe('NInferAdapter.healthCheck and stop', () => {
  it('polls the health URL until a 200', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 503, 200]
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 5 })
    expect(result.healthy).toBe(true)
    expect(result.status).toBe(200)
    expect(state.fetch).toHaveLength(3)
  })

  it('reports not-healthy when the cap is reached without a 200', async () => {
    const { host, state } = stubHost()
    state.fetchStatus = 503
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 2 })
    expect(result.healthy).toBe(false)
    expect(result.status).toBe(503)
    expect(state.fetch).toHaveLength(2)
  })

  it('stops the named container and signals the tracked process', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'docker',
      argv: ['docker', 'run', NINFER_DOCKER_IMAGE, 'serve', 'x.ninfer'],
      env: {},
      containerName: 'ninfer-18020',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    await adapter.deploy(plan)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop ninfer-18020')
    expect(state.killed).toContain(1234)
  })
})

describe('adapter modelRef (the registrar model seam)', () => {
  it('resolves the NInfer model id the engine serves, not the registry key', () => {
    const { host } = stubHost()
    const adapter = new NInferAdapter(host)
    // The config names the VramModel registry key; the engine serves the
    // artifact's --model-id alias, which is what the registrar publishes.
    expect(adapter.modelRef({ model: 'qwen3-27b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    expect(adapter.modelRef({ model: 'qwen3-35b' })).toEqual({
      id: 'Qwen3.8-35B-A3B',
      name: 'Qwen3.8-35B-A3B',
    })
    // The Swift 1.5 ablated 27B the local launcher bootstraps serves under the
    // same Qwen3.8-27B alias the engine advertises.
    expect(adapter.modelRef({ model: 'qwen3-27b-swift15' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    // An unknown model id falls back to the 27B artifact, the renderLaunch
    // rule, so a bare config always resolves a model.
    expect(adapter.modelRef({ model: 'qwen3-99b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    // No model named: the 27B default.
    expect(adapter.modelRef({})).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })
  })

  it('publishes the engine id for Hyper-Qwen until per-model data lands', () => {
    const { host } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    expect(adapter.modelRef({})).toEqual({ id: 'hyperqwen', name: 'Hyper-Qwen' })
  })
})

describe('HyperQwenAdapter', () => {
  it('renders a compose plan with the env the spec surface maps to', () => {
    const { host } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan = adapter.renderLaunch(
      { spec: 'dflash2', draftTokens: 15, port: 18020, composeFile: '/src/hyper-qwen/docker-compose.yml' },
      HW,
    )
    expect(plan.kind).toBe('compose')
    expect(plan.engineId).toBe('hyperqwen')
    expect(plan.composeFile).toBe('/src/hyper-qwen/docker-compose.yml')
    expect(plan.profile).toBe('single')
    expect(plan.port).toBe(18020)
    expect(plan.env).toEqual(
      expect.objectContaining({ SPEC: 'dflash2', DFLASH_TOKENS: '15', PORT: '18020' }),
    )
  })

  it('merges the card custom args into the compose env', () => {
    const { host } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan = adapter.renderLaunch(
      {
        spec: 'dflash2',
        port: 18020,
        customArgs: [{ key: 'EXTRA_FLAG', value: 'on' }, { key: 'BARE' }],
      },
      HW,
    )
    // The custom rows merge into the spec env: a valued row becomes an env var,
    // a bare row (no value) is skipped.
    expect(plan.env).toEqual(
      expect.objectContaining({ SPEC: 'dflash2', EXTRA_FLAG: 'on' }),
    )
    expect(plan.env).not.toHaveProperty('BARE')
  })

  it('deploys with compose up and stops with compose down', async () => {
    const { host, state } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'hyperqwen',
      kind: 'compose',
      env: {},
      composeFile: 'docker-compose.yml',
      profile: 'single',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe('docker compose -f docker-compose.yml --profile single up --pull always -d')
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker compose -f docker-compose.yml --profile single down')
  })

  it('applies the platform docker-tag compose arguments to the up and down lines', async () => {
    const { host, state } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'hyperqwen',
      kind: 'compose',
      env: {},
      composeFile: 'docker-compose.yml',
      profile: 'single',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    // The platform config's docker-tag field carries the compose arguments the
    // up step selects; the deploy applies them and the stop reuses them.
    const result = await adapter.deploy(plan, {
      engineId: 'hyperqwen',
      dockerTag: '--profile batch',
    })
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe('docker compose -f docker-compose.yml --profile batch up -d')
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker compose -f docker-compose.yml --profile batch down')
  })

  it('exposes the Hyper-Qwen spec surface and reports a failed compose up', async () => {
    const { host, state } = stubHost()
    const adapter = new HyperQwenAdapter(host)
    // The adapter's parameter surface is the Hyper-Qwen spec data.
    expect(adapter.parameters()).toHaveLength(HYPERQWEN_PARAMETERS.length)
    // A failed compose up reads as not-ok with the detail.
    state.runOk = false
    const plan: LaunchPlan = {
      engineId: 'hyperqwen',
      kind: 'compose',
      env: {},
      composeFile: 'docker-compose.yml',
      profile: 'single',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('compose up failed')
    // The health check polls the health URL through the shared helper.
    state.runOk = true
    state.fetchSequence = [503, 200]
    const health = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(health.healthy).toBe(true)
  })
})

describe('spec flag and env helpers', () => {
  it('flagsFromSpecs runs each toArgv over the config value or the spec default', () => {
    const flags = flagsFromSpecs(NINFER_PARAMETERS, { kvDtype: 'int8', maxContext: 4096 })
    expect(flags).toContain('--kv-dtype')
    expect(flags).toContain('int8')
    expect(flags).toContain('--max-context')
    expect(flags).toContain('4096')
    // A boolean default of false contributes no flag.
    expect(flags).not.toContain('--vision')
  })

  it('envFromSpecs runs each toEnv over the config value or the spec default', () => {
    const env = envFromSpecs(HYPERQWEN_PARAMETERS, { spec: 'dflash2', draftTokens: 7 })
    expect(env.SPEC).toBe('dflash2')
    expect(env.DFLASH_TOKENS).toBe('7')
    // A numeric default (gpuUtil 0.93) is spelled into the env.
    expect(env.GPU_UTIL).toBe('0.93')
  })

  it('customArgFlags spells a valued row as a flag pair and a bare row as a lone flag', () => {
    const flags = customArgFlags({
      customArgs: [
        { key: '--flash-attn', value: '1' },
        { key: '--verbose' },
      ],
    })
    expect(flags).toEqual(['--flash-attn', '1', '--verbose'])
  })

  it('customArgFlags drops blank keys, non-objects, and empty values', () => {
    const flags = customArgFlags({
      customArgs: [
        { key: '   ' },
        { key: '--ok', value: '' },
        null,
        42,
        { key: '--bare' },
      ],
    })
    // The blank key and the non-objects drop; a valueless --ok stays a lone flag.
    expect(flags).toEqual(['--ok', '--bare'])
  })

  it('customArgFlags reads a missing or non-array customArgs as no flags', () => {
    expect(customArgFlags({})).toEqual([])
    expect(customArgFlags({ customArgs: 'not-an-array' })).toEqual([])
  })

  it('customArgEnv maps valued rows to env vars and skips the bare rows', () => {
    const env = customArgEnv({
      customArgs: [
        { key: 'EXTRA', value: 'on' },
        { key: 'BARE' },
      ],
    })
    expect(env).toEqual({ EXTRA: 'on' })
  })

  it('customArgEnv reads a missing or non-array customArgs as an empty map', () => {
    expect(customArgEnv({})).toEqual({})
    expect(customArgEnv({ customArgs: 5 })).toEqual({})
  })
})

describe('pollHealth', () => {
  it('reads a connection failure (status 0) as not-ready and keeps polling', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [0, 0, 200]
    const plan: LaunchPlan = {
      engineId: 'ninfer',
      kind: 'process',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const result = await pollHealth(host, plan, { pollMs: 0, maxAttempts: 5 })
    expect(result.healthy).toBe(true)
    expect(state.fetch).toHaveLength(3)
  })
})

describe('LlamaCppAdapter', () => {
  it('renders a local process plan with the GGUF path and the spec flags', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', ctxSize: 8192, kvCacheType: 'q8_0', port: 8080, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('llamacpp')
    expect(plan.port).toBe(8080)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8080/health')
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.modelDirectory).toBe('/models')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('llama-server')
    expect(argv).toContain('--model')
    // The process plan joins the model dir with the host separator.
    expect(argv).toContain(join('/models', 'Qwen3.8-27B-Q4_K_M.gguf'))
    expect(argv).toContain('--ctx-size')
    expect(argv).toContain('8192')
    expect(argv).toContain('--cache-type-k')
    expect(argv).toContain('q8_0')
    expect(argv).toContain('--port')
    expect(argv).toContain('8080')
  })

  it('appends the card custom args to the process argv after the spec flags', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      {
        port: 8080,
        customArgs: [{ key: '--n-gpu-layers', value: '99' }],
      },
      HW,
    )
    const argv = plan.argv ?? []
    const flagIndex = argv.indexOf('--n-gpu-layers')
    expect(flagIndex).toBeGreaterThan(-1)
    expect(argv[flagIndex + 1]).toBe('99')
  })

  it('renders a docker plan with the ggml image, a named container, and the host port map', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', buildMode: 'docker', ctxSize: 8192, port: 8080, modelDirectory: '/models' },
      HW,
    )
    expect(plan.kind).toBe('docker')
    expect(plan.containerName).toBe('llamacpp-8080')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv[1]).toBe('run')
    expect(argv).toContain(LLAMACPP_DOCKER_IMAGE)
    expect(argv).toContain('--model')
    expect(argv).toContain('/models/Qwen3.8-27B-Q4_K_M.gguf')
  })

  it('defaults to the 27B artifact and the 8080 port when the config names neither', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch({}, HW)
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.port).toBe(8080)
    expect(plan.argv?.[2]).toBe('Qwen3.8-27B-Q4_K_M.gguf')
  })

  it('launches a directory-scanned .gguf file as-is', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'Qwen3.8-27B-Q4_K_M.gguf', modelDirectory: '/models', port: 8080 },
      HW,
    )
    expect(plan.modelId).toBe('Qwen3.8-27B-Q4_K_M.gguf')
    expect(plan.argv).toContain(join('/models', 'Qwen3.8-27B-Q4_K_M.gguf'))
  })

  it('builds in the engine directory, downloads the GGUF, and spawns the engine', async () => {
    const { host, state } = stubHost()
    // The checkout is behind the fork's master, so the conditional rebuild
    // rebases it (checkout + rebase + clean) and runs the build steps.
    state.runOutput['rev-list'] = '3'
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'process',
      argv: ['llama-server', '/models/x.gguf'],
      env: {},
      modelId: 'qwen3-27b',
      modelDirectory: '/models',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan, {
      engineId: 'llamacpp',
      engineDirectory: '/src/llama.cpp',
      engineFork: 'https://github.com/ggml-org/llama.cpp',
    })
    expect(result.ok).toBe(true)
    // The conditional rebuild prices the checkout against the fork, rebases it
    // because it is behind, cleans the tree, and runs the build steps before
    // the model download and the spawn.
    expect(state.run[0]).toContain('git -C /src/llama.cpp rev-parse --is-inside-work-tree')
    expect(state.run).toContain('git -C /src/llama.cpp remote add dsh-fork https://github.com/ggml-org/llama.cpp')
    expect(state.run).toContain('git -C /src/llama.cpp fetch dsh-fork || true')
    expect(state.run.some((c) => c.includes('git -C /src/llama.cpp rebase dsh-fork/master'))).toBe(true)
    expect(state.run).toContain('git -C /src/llama.cpp clean -fxd')
    expect(state.run.some((c) => c.includes('cmake -S /src/llama.cpp -B /src/llama.cpp/build'))).toBe(true)
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.run.some((c) => c.includes('--local-dir /models'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/llama.cpp')
    // The rebuild decision and the build command ride the result logs.
    expect(result.logs).toContain('is behind dsh-fork/master')
    expect(result.logs).toContain('cmake -S /src/llama.cpp -B /src/llama.cpp/build')
  })

  it('pulls the image and spawns the container for a docker plan', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'docker',
      argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE, '--model', 'x.gguf'],
      env: {},
      containerName: 'llamacpp-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${LLAMACPP_DOCKER_IMAGE}`)
    expect(state.spawn).toHaveLength(1)
  })

  it('polls the health URL and stops the named container and tracked process', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 200]
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp',
      kind: 'docker',
      argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE, '--model', 'x.gguf'],
      env: {},
      containerName: 'llamacpp-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(true)
    await adapter.deploy(plan)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop llamacpp-8080')
    expect(state.killed).toContain(1234)
  })

  it('publishes the artifact model id the engine serves', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    expect(adapter.modelRef({ model: 'qwen3-27b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    // No model named: the 27B default.
    expect(adapter.modelRef({})).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })
  })

  it('spells the spec surface into flags through the shared helper', () => {
    const flags = flagsFromSpecs(LLAMACPP_PARAMETERS, { ctxSize: 8192, kvCacheType: 'q4_0' })
    expect(flags).toContain('--ctx-size')
    expect(flags).toContain('8192')
    expect(flags).toContain('--cache-type-k')
    expect(flags).toContain('q4_0')
    // A boolean default of false contributes no flag.
    expect(flags).not.toContain('--flash-attn')
  })

  it('exposes the llama.cpp spec surface through the adapter', () => {
    const { host } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    expect(adapter.parameters()).toHaveLength(LLAMACPP_PARAMETERS.length)
    expect(adapter.parameters()).toBe(LLAMACPP_PARAMETERS)
  })

  it('skips a spec whose value and default are both undefined', () => {
    // A spec with a toArgv but no defaultValue contributes nothing when the
    // config leaves the key unset, so a bare config renders a bare plan.
    const specs = [
      {
        key: 'custom',
        label: 'Custom',
        description: 'A flag with no default.',
        form: { kind: 'text' },
        toArgv: (value: unknown) => (value ? ['--custom', String(value)] : []),
      },
    ]
    expect(flagsFromSpecs(specs, {})).toEqual([])
    expect(envFromSpecs(specs, {})).toEqual({})
  })

  it('reports a failed clone, build, and download as not-ok with the detail', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'process', argv: ['llama-server', 'x.gguf'], env: {},
      modelId: 'qwen3-27b', port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    // A missing checkout that cannot be cloned reads as a clone failure.
    state.runOk = false
    const cloneResult = await adapter.deploy(plan, {
      engineId: 'llamacpp', engineDirectory: '/src/llama.cpp',
      engineFork: 'https://github.com/ggml-org/llama.cpp',
    })
    expect(cloneResult.ok).toBe(false)
    expect(cloneResult.detail).toContain('git clone failed')
    // A checkout that is behind and whose build step fails reads as a build
    // failure (the git sync and the rebase succeed; only the cmake step breaks).
    state.runOk = true
    state.runOutput['rev-list'] = '3'
    const buildHost: LifecycleHost = {
      ...host,
      async runStream(command: string, onOutput: (chunk: string) => void): Promise<CommandOutcome> {
        if (command.includes('cmake')) return { ok: false, detail: 'build failed' }
        return host.runStream(command, onOutput)
      },
    }
    const buildResult = await new LlamaCppAdapter(buildHost).deploy(plan, {
      engineId: 'llamacpp', engineDirectory: '/src/llama.cpp',
    })
    expect(buildResult.ok).toBe(false)
    expect(buildResult.detail).toContain('build failed')
    // Without an engine dir the clone and build are skipped, so a failed run reads
    // as a model-download failure (the plan names the 27B artifact).
    state.runOk = false
    const downloadResult = await adapter.deploy(plan)
    expect(downloadResult.ok).toBe(false)
    expect(downloadResult.detail).toContain('model download failed')
    expect(state.run.length).toBeGreaterThan(0)
  })

  it('skips the git sync entirely when autoRebuild is off', async () => {
    const { host, state } = stubHost()
    // The checkout is behind (the rev-list count reads as 3), but the Auto
    // Rebuild checkbox is off, so the git sync (fetch, rebase, rebuild) is
    // skipped and the checkout launches as-is.
    state.runOutput['rev-list'] = '3'
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'process', argv: ['llama-server', 'x.gguf'], env: {},
      modelId: 'qwen3-27b', port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(
      plan,
      { engineId: 'llamacpp', engineDirectory: '/src/llama.cpp' },
      undefined,
      { autoRebuild: false },
    )
    expect(result.ok).toBe(true)
    // No git sync commands ran: no checkout probe, no fetch, no rebase, no
    // clean, and no build.
    expect(state.run.some((c) => c.includes('git -C /src/llama.cpp rev-parse --is-inside-work-tree'))).toBe(false)
    expect(state.run.some((c) => c.includes('git -C /src/llama.cpp'))).toBe(false)
    expect(state.run.some((c) => c.includes('cmake -S /src/llama.cpp'))).toBe(false)
    // The model download still runs, and the engine spawns from the checkout.
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/src/llama.cpp')
  })

  it('reports a failed docker pull as not-ok and treats a compose plan as a no-op', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'docker', argv: ['docker', 'run', LLAMACPP_DOCKER_IMAGE],
      env: {}, containerName: 'llamacpp-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('docker pull failed')
    // A compose plan is a no-op for a process/docker engine.
    state.runOk = true
    const compose: LaunchPlan = { engineId: 'llamacpp', kind: 'compose', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    expect(await adapter.deploy(compose)).toEqual({ ok: true })
    expect(state.spawn).toHaveLength(0)
  })

  it('skips the model download when the plan names no artifact', async () => {
    const { host, state } = stubHost()
    const adapter = new LlamaCppAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'llamacpp', kind: 'process', argv: ['llama-server', 'x.gguf'], env: {},
      port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    // No modelId, so no hf download command runs; only the spawn happens.
    expect(state.run).toHaveLength(0)
    expect(state.spawn).toHaveLength(1)
  })
})

describe('StrataAdapter', () => {
  it('renders a docker plan with the Strata image and a named container', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090, buildMode: 'docker' }, HW)
    expect(plan.kind).toBe('docker')
    expect(plan.engineId).toBe('strata')
    expect(plan.containerName).toBe('strata-8090')
    expect(plan.port).toBe(8090)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8090/health')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('docker')
    expect(argv).toContain(STRATA_DOCKER_IMAGE)
    // The docker plan carries the model-download volume and the GPU ulimit.
    expect(argv).toContain('strata-data:/data')
    expect(argv).toContain('memlock=-1:-1')
  })

  it('renders the binary plan (the default mode) as a strata launch process', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    // A bare config renders the binary plan: the strata Terminal the install
    // script places on the PATH.
    const plan = adapter.renderLaunch({ port: 8090 }, HW)
    expect(plan.kind).toBe('process')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('strata')
    expect(argv[1]).toBe('launch')
    expect(argv).toContain('--no-tui')
    expect(plan.port).toBe(8090)
  })

  it('spells the spec surface flags onto the binary plan argv', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, buildMode: 'binary', model: 'iq3_s', vision: 'gpu', parallel: 4 },
      HW,
    )
    const argv = plan.argv ?? []
    expect(argv).toContain('--model')
    expect(argv).toContain('iq3_s')
    expect(argv).toContain('--vision')
    expect(argv).toContain('gpu')
    expect(argv).toContain('--parallel')
    expect(argv).toContain('4')
  })

  it('renders the source-build plan as setup.sh with the model', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, buildMode: 'local', model: 'iq3_s', family: 'coder' },
      HW,
    )
    expect(plan.kind).toBe('process')
    // setup.sh is model-aware and self-contained: it reuses the built engine,
    // downloads the named model, and starts it. The family and model are
    // spelled as flags, and vision maps on to yes.
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('setup.sh')
    expect(argv).toContain('--model')
    expect(argv).toContain('iq3_s')
    expect(argv).toContain('--family')
    expect(argv).toContain('coder')
    expect(argv).toContain('--vision')
    expect(argv).toContain('yes')
  })

  it('renders the source-build plan as START-HERE.bat on a Windows host', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, buildMode: 'local', model: 'iq3_s', family: 'coder' },
      { ...HW, os: 'windows' },
    )
    expect(plan.kind).toBe('process')
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('START-HERE.bat')
    expect(argv).toContain('--model')
    expect(argv).toContain('iq3_s')
    expect(argv).toContain('--family')
    expect(argv).toContain('coder')
    expect(plan.os).toBe('windows')
  })

  it('renders the source-build plan as setup.sh on a macOS host', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, buildMode: 'local', model: 'iq3_s' },
      { ...HW, os: 'macos' },
    )
    const argv = plan.argv ?? []
    expect(argv[0]).toBe('setup.sh')
    expect(plan.os).toBe('macos')
  })

  it('resolves the source-build setup.sh to an absolute path in the checkout', async () => {
    const { host, state } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090, buildMode: 'local', model: 'iq3_s' }, HW)
    const result = await adapter.deploy(plan, {
      engineId: 'strata',
      engineDirectory: '/src/strata',
    })
    expect(result.ok).toBe(true)
    // spawn resolves a bare name against PATH, so the launch names the script
    // by its absolute path in the checkout, with the checkout as the cwd.
    expect(state.spawn).toHaveLength(1)
    // The spawn resolves the bare script name against the checkout with the
    // host separator; the cwd is the checkout dir itself.
    expect(state.spawn[0]?.argv[0]).toBe(join('/src/strata', 'setup.sh'))
    expect(state.spawn[0]?.cwd).toBe('/src/strata')
  })

  it('fails the source-build launch when no engine directory is configured', async () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch({ port: 8090, buildMode: 'local', model: 'iq3_s' }, HW)
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('engine directory')
  })

  it('appends the card custom args to the docker argv after the image', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan = adapter.renderLaunch(
      { port: 8090, buildMode: 'docker', customArgs: [{ key: '--device', value: 'cuda:1' }] },
      HW,
    )
    const argv = plan.argv ?? []
    const imageIndex = argv.indexOf(STRATA_DOCKER_IMAGE)
    expect(imageIndex).toBeGreaterThan(-1)
    expect(argv[imageIndex + 1]).toBe('--device')
    expect(argv[imageIndex + 2]).toBe('cuda:1')
  })

  it('pulls the image and stops the named container', async () => {
    const { host, state } = stubHost()
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata',
      kind: 'docker',
      argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {},
      containerName: 'strata-8080',
      port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run[0]).toBe(`docker pull ${STRATA_DOCKER_IMAGE}`)
    await adapter.stop(plan)
    expect(state.run[1]).toBe('docker stop strata-8080')
    expect(state.killed).toContain(1234)
  })

  it('publishes the engine id until per-model data lands', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    expect(adapter.modelRef({})).toEqual({ id: 'strata', name: 'Strata' })
  })

  it('reports a failed docker pull as not-ok', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'docker', argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {}, containerName: 'strata-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('docker pull failed')
  })

  it('polls the health URL until a 200', async () => {
    const { host, state } = stubHost()
    state.fetchSequence = [503, 200]
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'docker', argv: ['docker', 'run', STRATA_DOCKER_IMAGE],
      env: {}, containerName: 'strata-8080', port: 8080,
      healthUrl: 'http://127.0.0.1:8080/health',
    }
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(true)
    expect(result.state).toBe('ready')
    expect(state.fetch).toHaveLength(2)
  })

  it('reports the downloading state while the process fetches its files', async () => {
    // A host whose spawned handle exposes a mutable logs buffer the test drives
    // to show the download in progress; the health URL stays down (503) for
    // the whole poll.
    const logs = 'Downloading the engine… 10%'
    const host: LifecycleHost = {
      async run(): Promise<CommandOutcome> {
        return { ok: true }
      },
      spawn(): ProcessHandle {
        return {
          pid: 1234,
          kill: (): void => {},
          get logs(): string {
            return logs
          },
        }
      },
      async fetch(): Promise<FetchResult> {
        return { status: 503, ok: false }
      },
    }
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'process', argv: ['strata', 'launch'],
      env: {}, port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    // The deploy step tracks the spawned handle, so the health poll reads it.
    await adapter.deploy(plan)
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(false)
    expect(result.state).toBe('downloading')
    expect(result.detail).toContain('downloading')
  })

  it('reports the failed state when a tracked start times out', async () => {
    // The process is running (the handle is tracked) and past the download
    // (the logs show the start), but the health URL never returns 200, so the
    // start times out and reads as failed.
    const logs = 'Engine 0.1.48 is installed and will be used on the next start'
    const host: LifecycleHost = {
      async run(): Promise<CommandOutcome> {
        return { ok: true }
      },
      spawn(): ProcessHandle {
        return {
          pid: 1234,
          kill: (): void => {},
          get logs(): string {
            return logs
          },
        }
      },
      async fetch(): Promise<FetchResult> {
        return { status: 503, ok: false }
      },
    }
    const adapter = new StrataAdapter(host)
    const plan: LaunchPlan = {
      engineId: 'strata', kind: 'process', argv: ['strata', 'launch'],
      env: {}, port: 8080, healthUrl: 'http://127.0.0.1:8080/health',
    }
    await adapter.deploy(plan)
    const result = await adapter.healthCheck(plan, { pollMs: 0, maxAttempts: 3 })
    expect(result.healthy).toBe(false)
    expect(result.state).toBe('failed')
  })
})

describe('StrataAdapter model discovery and modalities', () => {
  it('discovers the model the running engine auto-selected', async () => {
    const { host, state } = stubHost()
    state.runOutput['/v1/models'] = JSON.stringify({
      object: 'list',
      data: [{ id: 'qwen3.8-flash-next-iq3_s', object: 'model', owned_by: 'strata' }],
    })
    const adapter = new StrataAdapter(host)
    const ref = await adapter.discoverModel?.({ port: 8090 })
    expect(ref).toEqual({
      id: 'qwen3.8-flash-next-iq3_s',
      name: 'qwen3.8-flash-next-iq3_s',
    })
    // The query runs through the terminal (curl, capped at a few seconds)
    // against the config port's model endpoint.
    expect(
      state.run.some((command) =>
        command.includes('curl -fsS --max-time 3 http://127.0.0.1:8090/v1/models'),
      ),
    ).toBe(true)
  })

  it('skips discovery when the config names a model', async () => {
    const { host, state } = stubHost()
    state.runOutput['/v1/models'] = '{"data":[{"id":"qwen3.8-flash-next-iq3_s"}]}'
    const adapter = new StrataAdapter(host)
    // A named model routes through modelRef; discovery answers only for the
    // engine's auto-selected model, and it does not even query the engine.
    const ref = await adapter.discoverModel?.({ port: 8090, model: 'iq3_s' })
    expect(ref).toBeUndefined()
    expect(state.run).toHaveLength(0)
  })

  it('reads a down engine (a failed curl) as no discovery', async () => {
    const { host, state } = stubHost()
    state.runOk = false
    const adapter = new StrataAdapter(host)
    expect(await adapter.discoverModel?.({ port: 8090 })).toBeUndefined()
  })

  it('reads a non-JSON answer as no discovery', async () => {
    const { host, state } = stubHost()
    state.runOutput['/v1/models'] = '<html>502 Bad Gateway</html>'
    const adapter = new StrataAdapter(host)
    expect(await adapter.discoverModel?.({ port: 8090 })).toBeUndefined()
  })

  it('discovers nothing on a host without output capture', async () => {
    // A LifecycleHost without runStream cannot read the command's stdout, so
    // discovery stays a no-op and the register route falls back to modelRef.
    const streamlessHost: LifecycleHost = {
      async run(): Promise<CommandOutcome> {
        return { ok: true }
      },
      spawn(): ProcessHandle {
        return { pid: 1, logs: '', kill: () => {} }
      },
      async fetch(): Promise<FetchResult> {
        return { ok: true, status: 200 }
      },
    }
    const adapter = new StrataAdapter(streamlessHost)
    expect(await adapter.discoverModel?.({ port: 8090 })).toBeUndefined()
  })

  it('publishes image input by default and text-only with vision off', () => {
    const { host } = stubHost()
    const adapter = new StrataAdapter(host)
    // Strata's models read pictures and vision (on|gpu|cpu) is on by default,
    // so only 'off' withholds the Image input.
    expect(adapter.modelInput?.({ port: 8090 })).toEqual(['text', 'image'])
    expect(adapter.modelInput?.({ port: 8090, vision: 'on' })).toEqual(['text', 'image'])
    expect(adapter.modelInput?.({ port: 8090, vision: 'gpu' })).toEqual(['text', 'image'])
    expect(adapter.modelInput?.({ port: 8090, vision: 'off' })).toEqual(['text'])
  })
})

describe('strataServedModelId (the /v1/models reader)', () => {
  it('reads the first served model id', () => {
    expect(
      strataServedModelId('{"object":"list","data":[{"id":"qwen3.8-flash-next-iq3_s"},{"id":"x"}]}'),
    ).toBe('qwen3.8-flash-next-iq3_s')
  })

  it('reads the id when curl noise surrounds the JSON body', () => {
    const body = 'curl: (2) warning\n{"data":[{"id":"qwen3.8-flash-next-iq3_s"}]}\n'
    expect(strataServedModelId(body)).toBe('qwen3.8-flash-next-iq3_s')
  })

  it('skips entries with no usable id', () => {
    expect(strataServedModelId('{"data":[{"id":""},{"object":"model"},{"id":"qwen"}]}')).toBe(
      'qwen',
    )
  })

  it('reads no id from a non-JSON body, an empty list, or a missing data field', () => {
    expect(strataServedModelId('<html>502 Bad Gateway</html>')).toBeUndefined()
    expect(strataServedModelId('')).toBeUndefined()
    expect(strataServedModelId('{"data":[]}')).toBeUndefined()
    expect(strataServedModelId('{"error":{"message":"unauthorized"}}')).toBeUndefined()
  })
})

describe('strataPreReadyState (the download-phase reader)', () => {
  it('reads a download progress line as downloading', () => {
    expect(strataPreReadyState('Downloading the engine… 50%')).toBe('downloading')
    expect(strataPreReadyState('Getting the model files: 43.4 of 84.5 GB')).toBe('downloading')
    expect(strataPreReadyState('Unpacking 0.1.48 linux-x86_64-cuda-cuda13')).toBe('downloading')
    expect(strataPreReadyState('Checking the package signature and every file')).toBe('downloading')
  })

  it('reads a post-download start (or no output) as starting', () => {
    expect(strataPreReadyState('Engine 0.1.48 is installed and will be used on the next start')).toBe('starting')
    expect(strataPreReadyState('')).toBe('starting')
  })

  it('reads the tail, so a finished download no longer reads as downloading', () => {
    // The download lines are in the buffer, but the tail (the most recent
    // output, past the 2000-char window) is past the download, so it reads as
    // starting even though the progress lines are still in the log.
    const logs = 'Downloading the engine… 100%\n' + 'x'.repeat(2500) + '\nEngine is installed'
    expect(strataPreReadyState(logs)).toBe('starting')
  })
})

describe('nodeLifecycleHost (the live host the service wires in)', () => {
  it('runs a command through the shell and reads a clean exit as ok', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    const ok = await nodeLifecycleHost.run('echo local-infer-probe')
    expect(ok.ok).toBe(true)
  })

  it('runs a command in the shell named by the options', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // The probe is shell-specific: Write-Output is a PowerShell cmdlet that
    // fails in cmd (the Windows default shell), so a clean exit proves the
    // named shell ran the command. POSIX names sh, the default there.
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh'
    const command =
      process.platform === 'win32'
        ? 'Write-Output local-infer-shell-probe'
        : 'echo local-infer-shell-probe'
    const ok = await nodeLifecycleHost.run(command, { shell })
    expect(ok.ok).toBe(true)
  })

  it('streams a command run in the shell named by the options', async () => {
    const host = createNodeLifecycleHost()
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh'
    const command =
      process.platform === 'win32'
        ? 'Write-Output local-infer-stream-shell-probe'
        : 'echo local-infer-stream-shell-probe'
    const chunks: string[] = []
    const result = await host.runStream(command, (chunk) => chunks.push(chunk), { shell })
    expect(result?.ok).toBe(true)
    expect(chunks.join('')).toContain('local-infer-stream-shell-probe')
  })

  it('reads a non-zero exit as not-ok with the captured detail', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // `false` exits 1 with no stderr; the detail carries the error string.
    const failed = await nodeLifecycleHost.run('false')
    expect(failed.ok).toBe(false)
    expect(failed.detail?.length).toBeGreaterThan(0)
  })

  it('spawns a detached child the stop step can signal', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // A real node child: a no-op that exits immediately. The handle carries a
    // pid and a kill the stop step calls; the child is unrefed so it never
    // keeps the test process alive.
    const handle = nodeLifecycleHost.spawn(['node', '-e', 'setTimeout(() => {}, 50)'], {})
    expect(handle.pid).toBeGreaterThan(0)
    expect(typeof handle.kill).toBe('function')
    handle.kill()
  })

  it('reports a clean child exit through the handle onExit listener', async () => {
    const host = createNodeLifecycleHost()
    const handle = host.spawn(['node', '-e', 'process.exit(3)'], {})
    const exit = await onceExit(handle)
    expect(exit).toEqual({ code: 3, signal: null })
  })

  it('settles onExit with the spawn error for a binary that cannot start', async () => {
    // The crash regression: a child process with no 'error' listener turns a
    // failed spawn (ENOENT for a missing engine binary) into an
    // uncaughtException that takes the host down. Here the failure lands on
    // the handle: the listener fires, the logs carry the note, and this test
    // process survives the failed spawn.
    const host = createNodeLifecycleHost()
    const handle = host.spawn(['dsh-local-infer-missing-binary'], {})
    const exit = await onceExit(handle)
    expect(exit.code).toBeNull()
    expect(exit.error).toContain('dsh-local-infer-missing-binary')
    expect(handle.logs).toContain('spawn error')
  })

  it('reports a pkill as a signal exit through onExit', async () => {
    const host = createNodeLifecycleHost()
    // The card's kill commands and a stray pkill both signal the engine pid
    // directly; the close event must surface the signal, not a silent drop.
    const handle = host.spawn(['node', '-e', 'setTimeout(() => {}, 30000)'], {})
    const exitPromise = onceExit(handle)
    process.kill(handle.pid, 'SIGKILL')
    const exit = await exitPromise
    // Windows emulates signals by terminating the process, so the close event
    // reports a non-zero code and no signal; POSIX reports the signal itself.
    if (process.platform === 'win32') {
      expect(exit).toEqual({ code: 1, signal: null })
    } else {
      expect(exit).toEqual({ code: null, signal: 'SIGKILL' })
    }
  })

  it('fires a listener registered after the child already ended immediately', async () => {
    const host = createNodeLifecycleHost()
    const handle = host.spawn(['node', '-e', 'process.exit(0)'], {})
    await onceExit(handle)
    const seen: ProcessExitInfo[] = []
    handle.onExit?.((exit) => seen.push(exit))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.code).toBe(0)
  })

  it('reads a connection failure as status 0, the poll not-ready signal', async () => {
    const { nodeLifecycleHost } = await import('../src/adapters.ts')
    // Port 1 on loopback has nothing listening, so the fetch throws and the
    // host reports status 0, the same signal pollHealth treats as not-ready.
    const result = await nodeLifecycleHost.fetch('http://127.0.0.1:1/health')
    expect(result.status).toBe(0)
    expect(result.ok).toBe(false)
  })
})

describe('tracked children (the adapters children map)', () => {
  const plan: LaunchPlan = {
    engineId: 'ninfer',
    kind: 'process',
    argv: ['ninfer-serve', '/models/model.ninfer'],
    port: 18020,
    healthUrl: 'http://127.0.0.1:18020/health',
  }

  it('drops the tracked handle when the child dies, so a later stop signals nothing', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    const deploy = await adapter.deploy(plan)
    // The deploy hands the service a handle to watch, and the child is pkill'd.
    expect(deploy.handle?.pid).toBe(1234)
    for (const listener of state.exits) {
      listener({ code: null, signal: 'SIGKILL' })
    }
    await adapter.stop(plan)
    // The dead handle left the map with its child, so stop signals nothing
    // rather than a pid a recycled process may have taken over.
    expect(state.killed).toEqual([])
  })

  it('keeps the kill for a child that is still running', async () => {
    const { host, state } = stubHost()
    const adapter = new NInferAdapter(host)
    await adapter.deploy(plan)
    await adapter.stop(plan)
    expect(state.killed).toEqual([1234])
  })

  it('returns the spawned handle from every process and docker deploy path', async () => {
    const { host } = stubHost()
    const ninfer = new NInferAdapter(host)
    expect((await ninfer.deploy(plan)).handle?.pid).toBe(1234)
    const dockerPlan: LaunchPlan = { ...plan, kind: 'docker', containerName: 'llamacpp-18020' }
    const llamacpp = new LlamaCppAdapter(host)
    expect((await llamacpp.deploy(dockerPlan)).handle?.pid).toBe(1234)
    const llamacppPlan: LaunchPlan = { ...plan, engineId: 'llamacpp' }
    expect((await llamacpp.deploy(llamacppPlan)).handle?.pid).toBe(1234)
    const strata = new StrataAdapter(host)
    const strataPlan: LaunchPlan = { ...plan, engineId: 'strata', kind: 'docker', containerName: 'strata-18020' }
    expect((await strata.deploy(strataPlan)).handle?.pid).toBe(1234)
    const infernix = new InfernixAdapter(host)
    const infernixPlan: LaunchPlan = { ...plan, engineId: 'infernix' }
    expect((await infernix.deploy(infernixPlan)).handle?.pid).toBe(1234)
  })
})

describe('createNodeLifecycleHost (the debug-mode command logger)', () => {
  it('logs every run and spawn command through the debug logger', async () => {
    const seen: string[] = []
    const host = createNodeLifecycleHost((message) => {
      seen.push(message)
    })
    expect(host.debug).toBeTypeOf('function')
    await host.run('echo probe')
    host.spawn(['node', '-e', 'setTimeout(() => {}, 10)'], {}, '/tmp')
    host.spawn(['ninfer-serve', 'model.ninfer'], {})
    expect(seen).toEqual([
      'run: echo probe',
      'spawn: node -e setTimeout(() => {}, 10) (cwd: /tmp)',
      'spawn: ninfer-serve model.ninfer',
    ])
  })

  it('exposes no debug field and logs nothing when no logger is wired', () => {
    // The default live host carries no debug logger, so a normal run is quiet.
    expect(nodeLifecycleHost.debug).toBeUndefined()
    expect(createNodeLifecycleHost().debug).toBeUndefined()
  })

  it('keeps the fetch and spawn behavior of the live host', async () => {
    const host = createNodeLifecycleHost()
    const handle = host.spawn(['node', '-e', 'setTimeout(() => {}, 10)'], {})
    expect(handle.pid).toBeGreaterThan(0)
    handle.kill()
    // Port 1 on loopback has nothing listening, so the fetch reads as status 0.
    const result = await host.fetch('http://127.0.0.1:1/health')
    expect(result.status).toBe(0)
    expect(result.ok).toBe(false)
  })
})

describe('adapter launchSignature (the Phase 10 process-match data)', () => {
  it('NInfer: the local signature is the ninfer-serve binary and the config port', () => {
    const adapter = new NInferAdapter()
    const signature = adapter.launchSignature({ port: 18020 })
    expect(signature).toEqual({ binary: 'ninfer-serve', port: 18020 })
  })

  it('NInfer: the docker signature is the ghcr image marker and the config port', () => {
    const adapter = new NInferAdapter()
    const signature = adapter.launchSignature({ buildMode: 'docker', port: 19000 })
    expect(signature).toEqual({ binary: NINFER_DOCKER_IMAGE, port: 19000 })
  })

  it('NInfer: a bare config falls back to the adapter default port', () => {
    const adapter = new NInferAdapter()
    expect(adapter.launchSignature()).toEqual({ binary: 'ninfer-serve', port: 18020 })
  })

  it('Hyper-Qwen: the signature is the docker compose command, port, and toEnv keys', () => {
    const adapter = new HyperQwenAdapter()
    const signature = adapter.launchSignature({ port: 18021, spec: 'dflash2', ctx: 32768 })
    expect(signature?.binary).toBe('docker compose')
    expect(signature?.port).toBe(18021)
    // The toEnv keys ride along so a process line that carries env data must
    // set at least one of them.
    expect(signature?.envKeys).toEqual(
      expect.arrayContaining(['SPEC', 'CTX', 'KV']),
    )
  })

  it('llama.cpp: the local signature is the llama-server binary, the docker one the ggml image', () => {
    const adapter = new LlamaCppAdapter()
    expect(adapter.launchSignature({ port: 8081 })).toEqual({ binary: 'llama-server', port: 8081 })
    expect(adapter.launchSignature({ buildMode: 'docker', port: 8081 })).toEqual({
      binary: LLAMACPP_DOCKER_IMAGE,
      port: 8081,
    })
  })

  it('Strata: the signature is the strata marker for the process modes, the image for docker', () => {
    const adapter = new StrataAdapter()
    // The binary and source-build plans run the strata command, so the binary
    // name is the marker; the docker plan's host process is docker run of the
    // ghcr image, so the image name is the marker.
    expect(adapter.launchSignature({ port: 8082 })).toEqual({ binary: 'strata', port: 8082 })
    expect(adapter.launchSignature({ buildMode: 'local', port: 8082 })).toEqual({
      binary: 'strata',
      port: 8082,
    })
    expect(adapter.launchSignature({ buildMode: 'docker', port: 8082 })).toEqual({
      binary: STRATA_DOCKER_IMAGE,
      port: 8082,
    })
  })

  it('Infernix: the signature is the infernix-serve binary marker and the port', () => {
    const adapter = new InfernixAdapter()
    expect(adapter.launchSignature({ port: 8080 })).toEqual({
      binary: 'infernix-serve',
      port: 8080,
    })
    // The .exe command line carries the marker, so a Windows process matches.
    expect(adapter.launchSignature()).toEqual({ binary: 'infernix-serve', port: 8080 })
  })
})

describe('InfernixAdapter', () => {
  it('renders a local process plan with the artifact path and the spec flags', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3-27b',
        kvDtype: 'int8',
        maxContext: 240000,
        port: 8080,
        modelDirectory: '/models',
      },
      HW,
    )
    expect(plan.kind).toBe('process')
    expect(plan.engineId).toBe('infernix')
    expect(plan.port).toBe(8080)
    expect(plan.healthUrl).toBe('http://127.0.0.1:8080/health')
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.modelDirectory).toBe('/models')
    const argv = plan.argv ?? []
    expect(argv[0]).toContain('infernix-serve')
    // The process plan joins the model dir with the host separator.
    expect(argv[1]).toBe(join('/models', 'qwen3_8_27b_nvfp4-nvidia.ninfer'))
    expect(argv).toContain('--host')
    expect(argv).toContain('127.0.0.1')
    expect(argv).toContain('--port')
    expect(argv).toContain('8080')
    expect(argv).toContain('--model-id')
    expect(argv).toContain('Qwen3.8-27B')
    expect(argv).toContain('--kv-dtype')
    expect(argv).toContain('int8')
    expect(argv).toContain('--max-context')
    expect(argv).toContain('240000')
  })

  it('spells the Infernix-only flags onto the argv, and only for this engine', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen38-flash-next',
        spec: 'dflash2',
        draftTokens: 'auto',
        lmHeadDraft: true,
        draftModel: '/models/Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
        ngramVolume: '/models/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram',
        ngramResidency: 'ram',
        ngramDraftTokens: 31,
        ngramMinMatch: 12,
        expertRamMib: 49152,
        hostContextMib: 8192,
        maxConcurrency: 2,
        prefillChunk: 4096,
        kvCapacity: 262144,
        port: 8080,
        modelDirectory: '/models',
      },
      HW,
    )
    const argv = plan.argv ?? []
    expect(argv[1]).toBe(
      join('/models', 'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix'),
    )
    expect(argv).toContain('--ngram-volume')
    expect(argv).toContain('/models/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Infernix.ngram')
    expect(argv).toContain('--draft-model')
    expect(argv).toContain('/models/Qwen3.8-Flash-Next-DFlash2-Infernix.infernix')
    expect(argv).toContain('--spec')
    expect(argv).toContain('dflash2')
    expect(argv).toContain('--draft-tokens')
    expect(argv).toContain('auto')
    expect(argv).toContain('--lm-head-draft')
    expect(argv).toContain('--ngram-residency')
    expect(argv).toContain('ram')
    expect(argv).toContain('--ngram-draft-tokens')
    expect(argv).toContain('31')
    expect(argv).toContain('--ngram-min-match')
    expect(argv).toContain('12')
    expect(argv).toContain('--expert-ram-mib')
    expect(argv).toContain('49152')
    expect(argv).toContain('--host-context-mib')
    expect(argv).toContain('8192')
    expect(argv).toContain('--max-concurrency')
    expect(argv).toContain('2')
    expect(argv).toContain('--kv-capacity')
    expect(argv).toContain('262144')
    // The NInfer adapter never spells the Infernix-only flags.
    const ninferAdapter = new NInferAdapter(host)
    const ninferPlan = ninferAdapter.renderLaunch(
      { model: 'qwen3-27b', port: 18020, modelDirectory: '/models' },
      HW,
    )
    const ninferArgv = ninferPlan.argv ?? []
    for (const flag of [
      '--ngram-volume',
      '--draft-model',
      '--ngram-residency',
      '--ngram-draft-tokens',
      '--ngram-min-match',
      '--expert-ram-mib',
      '--host-context-mib',
      '--max-pending-requests',
      '--no-cuda-graph',
      '--reproducible',
      '--lossless',
      '--rope-yarn-factor',
      '--tolerant-tool-calls',
      '--reasoning-loop',
      '--expert-state',
      '--prefix-cache-file',
      '--expert-pin-mib',
      '--ram-headroom-mib',
      '--vram-headroom-mib',
    ]) {
      expect(ninferArgv, `${flag} off the NInfer argv`).not.toContain(flag)
    }
  })

  it('defaults to the 27B artifact and the 8080 port when the config names neither', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch({}, HW)
    expect(plan.modelId).toBe('qwen3-27b')
    expect(plan.port).toBe(8080)
    expect(plan.argv?.[1]).toBe(INFERNIX_MODEL_ARTIFACTS['qwen3-27b']!.file)
  })

  it('spells --draft-model from the selected DFlash2 preset when dflash2 is on', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const presetFile = 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix'
    const plan = adapter.renderLaunch(
      {
        model: 'qwen38-flash-next',
        spec: 'dflash2',
        draftModelPreset: presetFile,
        modelDirectory: '/models',
        port: 8080,
      },
      HW,
    )
    const argv = plan.argv ?? []
    expect(argv).toContain('--draft-model')
    // The preset resolves to the model directory plus the drafter file, the
    // layout the hf CLI download leaves, joined with the host separator.
    expect(argv).toContain(join('/models', presetFile, presetFile))
  })

  it('spells --draft-model from the Custom path field when dflash2 is on', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen38-flash-next',
        spec: 'dflash2',
        draftModelPreset: 'custom',
        draftModel: '/models/custom-drafter.infernix',
        port: 8080,
      },
      HW,
    )
    const argv = plan.argv ?? []
    expect(argv).toContain('--draft-model')
    expect(argv).toContain('/models/custom-drafter.infernix')
  })

  it('spells no --draft-model when the dflash2 backend is not selected', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', spec: 'mtp', port: 8080 },
      HW,
    )
    expect(plan.argv ?? []).not.toContain('--draft-model')
  })

  it('launches a directory-scanned .infernix file as-is', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix' },
      HW,
    )
    expect(plan.modelId).toBe(
      'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix',
    )
    expect(plan.argv?.[1]).toBe(
      'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix',
    )
  })

  it('appends the card custom args to the process argv after the spec flags', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      {
        model: 'qwen3-27b',
        port: 8080,
        customArgs: [
          { key: '--log-level', value: 'debug' },
          { key: '--no-cuda-graph' },
        ],
      },
      HW,
    )
    const argv = plan.argv ?? []
    const flagIndex = argv.indexOf('--log-level')
    expect(flagIndex).toBeGreaterThan(-1)
    expect(argv[flagIndex + 1]).toBe('debug')
    expect(argv).toContain('--no-cuda-graph')
  })

  it('builds through the engine preset, downloads the model, and spawns the engine', async () => {
    const { host, state } = stubHost()
    // The checkout is behind the remote main, so the conditional rebuild runs
    // the engine's own preset sequence.
    state.runOutput['rev-list'] = '3'
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', port: 8080, modelDirectory: '/models' },
      HW,
    )
    const result = await adapter.deploy(plan, {
      engineId: 'infernix',
      engineDirectory: '/engines/infernix',
    })
    expect(result.ok).toBe(true)
    expect(result.handle?.pid).toBe(1234)
    // The build runs the engine's own preset sequence in the engine
    // directory, then the hf CLI pulls the single-file artifact.
    expect(state.run).toContain('cd /engines/infernix && cmake --preset release && cmake --build build -j')
    expect(state.run).toContain('hf download Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3 qwen3_8_27b_nvfp4-nvidia.ninfer --local-dir /models')
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/engines/infernix')
  })

  it('downloads the whole repo for the multi-file Flash-Next artifact', async () => {
    const { host, state } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen38-flash-next', port: 8080, modelDirectory: '/models' },
      HW,
    )
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run).toEqual([
      'hf download Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix --local-dir /models',
    ])
  })

  it('syncs the engine fork before the build', async () => {
    const { host, state } = stubHost()
    // The checkout is behind the fork's main, so the conditional rebuild rebases
    // it onto the fork and runs the engine's preset sequence.
    state.runOutput['rev-list'] = '3'
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch({ model: 'qwen3-27b', port: 8080 }, HW)
    await adapter.deploy(plan, {
      engineId: 'infernix',
      engineDirectory: '/engines/infernix',
      engineFork: 'https://github.com/wallawalla47/infernix',
    })
    expect(state.run).toContain('git -C /engines/infernix remote add dsh-fork https://github.com/wallawalla47/infernix')
    expect(state.run).toContain('git -C /engines/infernix fetch dsh-fork || true')
    expect(state.run.some((c) => c.includes('git -C /engines/infernix rebase dsh-fork/main'))).toBe(true)
    expect(state.run).toContain('cd /engines/infernix && cmake --preset release && cmake --build build -j')
  })

  it('skips the git sync entirely when autoRebuild is off', async () => {
    const { host, state } = stubHost()
    // The checkout is behind the fork's main (the rev-list count reads as 3),
    // but the Auto Rebuild checkbox is off, so the git sync (fetch, rebase,
    // rebuild) is skipped and the checkout launches as-is.
    state.runOutput['rev-list'] = '3'
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch(
      { model: 'qwen3-27b', port: 8080, modelDirectory: '/models' },
      HW,
    )
    const result = await adapter.deploy(
      plan,
      {
        engineId: 'infernix',
        engineDirectory: '/engines/infernix',
        engineFork: 'https://github.com/wallawalla47/infernix',
      },
      undefined,
      { autoRebuild: false },
    )
    expect(result.ok).toBe(true)
    // No git sync commands ran: no checkout probe, no fetch, no rebase, no
    // clean, and no build.
    expect(state.run.some((c) => c.includes('git -C /engines/infernix rev-parse --is-inside-work-tree'))).toBe(false)
    expect(state.run.some((c) => c.includes('git -C /engines/infernix'))).toBe(false)
    expect(state.run.some((c) => c.includes('cmake --preset release'))).toBe(false)
    // The model download still runs, and the engine spawns from the checkout.
    expect(state.run.some((c) => c.includes('hf download'))).toBe(true)
    expect(state.spawn).toHaveLength(1)
    expect(state.spawn[0]?.cwd).toBe('/engines/infernix')
  })

  it('skips the clone and build when no platform config is stored', async () => {
    const { host, state } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch({ model: 'qwen3-27b', port: 8080, modelDirectory: '/models' }, HW)
    const result = await adapter.deploy(plan)
    expect(result.ok).toBe(true)
    expect(state.run).toEqual([
      'hf download Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3 qwen3_8_27b_nvfp4-nvidia.ninfer --local-dir /models',
    ])
    expect(state.spawn).toHaveLength(1)
  })

  it('reports a failed build as not-ok with the detail', async () => {
    const { host, state } = stubHost()
    // The checkout is behind (so the build runs), and only the build step fails.
    state.runOutput['rev-list'] = '3'
    const buildHost: LifecycleHost = {
      ...host,
      async runStream(command: string, onOutput: (chunk: string) => void): Promise<CommandOutcome> {
        if (command.includes('cmake')) return { ok: false, detail: 'build failed' }
        return host.runStream(command, onOutput)
      },
    }
    const adapter = new InfernixAdapter(buildHost)
    const plan = adapter.renderLaunch({ model: 'qwen3-27b', port: 8080 }, HW)
    const result = await adapter.deploy(plan, {
      engineId: 'infernix',
      engineDirectory: '/engines/infernix',
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('build failed')
  })

  it('polls the health URL and stops the tracked process', async () => {
    const { host, state } = stubHost()
    const adapter = new InfernixAdapter(host)
    const plan = adapter.renderLaunch({ model: 'qwen3-27b', port: 8080 }, HW)
    await adapter.deploy(plan)
    state.fetchStatus = 200
    const health = await adapter.healthCheck(plan, { pollMs: 0 })
    expect(health.healthy).toBe(true)
    await adapter.stop(plan)
    expect(state.killed).toEqual([1234])
  })

  it('publishes the artifact model id the engine serves', () => {
    const { host } = stubHost()
    const adapter = new InfernixAdapter(host)
    expect(adapter.modelRef({ model: 'qwen3-27b' })).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
    })
    expect(adapter.modelRef({ model: 'qwen38-flash-next' })).toEqual({
      id: 'Qwen3.8-Flash-Next',
      name: 'Qwen3.8-Flash-Next',
    })
  })

  it('spells the Infernix spec surface into flags through the shared helper', () => {
    const flags = flagsFromSpecs(
      [
        {
          key: 'ngramVolume',
          label: 'N-gram volume',
          description: 'Points the engine at the PLE n-gram table file.',
          form: { kind: 'path' },
          toArgv: (value) => (value ? ['--ngram-volume', String(value)] : []),
        },
      ],
      { ngramVolume: '/models/table.ngram' },
    )
    expect(flags).toEqual(['--ngram-volume', '/models/table.ngram'])
  })
})
