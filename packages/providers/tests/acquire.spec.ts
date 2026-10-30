import { describe, expect, it } from 'vitest'
import {
  ENGINE_SOURCES,
  FORK_REMOTE,
  buildEngineRepo,
  engineBinary,
  engineBuildDir,
  engineBuildSteps,
  engineSource,
  syncAndRebuildEngine,
  syncEngineRepo,
} from '../src/acquire.ts'
import { ENGINES } from '../src/engines.ts'
import { createNodeLifecycleHost } from '../src/adapters.ts'
import type { CommandOutcome, LifecycleHost, RunOptions } from '../../core/lib/index.js'

/**
 * A stub LifecycleHost for the Get steps. `exists` decides whether the
 * `git -C <dir> rev-parse --is-inside-work-tree` probe finds a checkout;
 * `stream` feeds the stdout a streamed command prints (the dirty-check reads
 * it); `fail` lists command substrings whose run fails. Every command and
 * every streamed chunk is recorded so the assertions read the sequence.
 */
function stubHost(options?: {
  exists?: boolean
  stream?: Record<string, string>
  fail?: string[]
  noStream?: boolean
}) {
  const state = {
    run: [] as string[],
    streamed: [] as string[],
    // The shell option each run/runStream call carried (the engine OS
    // profile's shell, e.g. powershell.exe for the Windows vcpkg route);
    // undefined when the call kept the host's default shell.
    runShells: [] as (string | undefined)[],
    streamedShells: [] as (string | undefined)[],
    logged: '',
  }
  const fails = (command: string): boolean =>
    (options?.fail ?? []).some((needle) => command.includes(needle))
  const outcome = (command: string): CommandOutcome =>
    fails(command) ? { ok: false, detail: `exit 1: ${command}` } : { ok: true }
  const streamText = (command: string): string => {
    const stream = options?.stream ?? {}
    const key = Object.keys(stream).find((needle) => command.includes(needle))
    return key === undefined ? '' : stream[key]!
  }
  const host: LifecycleHost = {
    async run(command: string, runOptions?: RunOptions): Promise<CommandOutcome> {
      state.run.push(command)
      state.runShells.push(runOptions?.shell)
      if (command.includes('rev-parse --is-inside-work-tree')) {
        return options?.exists === false ? { ok: false } : { ok: true }
      }
      return outcome(command)
    },
    ...(options?.noStream === true
      ? {}
      : {
          async runStream(
            command: string,
            onOutput: (chunk: string) => void,
            runOptions?: RunOptions,
          ): Promise<CommandOutcome> {
            state.streamed.push(command)
            state.streamedShells.push(runOptions?.shell)
            const text = streamText(command)
            if (text !== '') {
              onOutput(text)
            }
            return outcome(command)
          },
        }),
  }
  return { host, state }
}

describe('ENGINE_SOURCES', () => {
  it('carries a source for every engine the card offers', () => {
    for (const engine of ENGINES) {
      const source = engineSource(engine.id)
      expect(source, engine.id).toBeDefined()
      expect(source?.repo).toMatch(/^https:\/\/github\.com\//)
      expect(source?.branch).toBeTruthy()
      expect(Array.isArray(source?.buildSteps)).toBe(true)
    }
  })

  it('names the fork remote the sync step adds a provided fork under', () => {
    expect(FORK_REMOTE).toBe('dsh-fork')
  })

  it('exposes the build steps through engineBuildSteps, empty for an unknown engine', () => {
    expect(engineBuildSteps('ninfer')).toEqual(ENGINE_SOURCES.ninfer?.buildSteps)
    expect(engineBuildSteps('nope')).toEqual([])
  })

  it('reads the Windows build steps for a Windows host and the base list otherwise', () => {
    expect(engineBuildSteps('ninfer', 'windows')).toEqual(ENGINE_SOURCES.ninfer?.windowsBuildSteps)
    expect(engineBuildSteps('ninfer', 'windows')?.[0]).toContain('vcpkg install')
    // An engine with no Windows variant falls back to its base list.
    expect(engineBuildSteps('llamacpp', 'windows')).toEqual(ENGINE_SOURCES.llamacpp?.buildSteps)
  })

  it('reads the OS-specific build directory and binary name from the engine profile', () => {
    // The NInfer Windows vcpkg route writes the Release binary into the Windows
    // build tree, not the shared Linux build directory, and the binary is the
    // .exe. A Linux host reads the shared build directory and the plain name.
    expect(engineBuildDir('ninfer', 'windows')).toBe('build-windows/apps/Release')
    expect(engineBuildDir('ninfer')).toBe('build')
    expect(engineBinary('ninfer', 'windows')).toBe('ninfer-serve.exe')
    expect(engineBinary('ninfer')).toBe('ninfer-serve')
    // An engine that installs its binary to the path (Strata) carries no build
    // directory, so it reads as the shared default.
    expect(engineBuildDir('strata')).toBe('build')
    // A compose engine (Hyper-Qwen) carries no local binary.
    expect(engineBinary('hyperqwen')).toBeUndefined()
    // An unknown engine reads as the shared default directory and no binary.
    expect(engineBuildDir('nope')).toBe('build')
    expect(engineBinary('nope')).toBeUndefined()
  })

  it('reads an unknown engine as no source', () => {
    expect(engineSource('nope')).toBeUndefined()
  })
})

describe('syncEngineRepo', () => {
  it('clones the upstream repo when no checkout exists and no fork is provided', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/models/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(state.logged).toContain(
      '$ git clone https://github.com/Neroued/ninfer /models/ninfer',
    )
  })

  it('clones the fork when one is provided', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncEngineRepo(
      host,
      {
        engineId: 'ninfer',
        directory: '/models/ninfer',
        fork: 'https://github.com/me/ninfer',
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(state.logged).toContain(
      '$ git clone https://github.com/me/ninfer /models/ninfer',
    )
  })

  it('reports a failed clone', async () => {
    const { host, state } = stubHost({ exists: false, fail: ['git clone'] })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/models/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('git clone failed')
  })

  it('aborts and alerts when the checkout has local changes', async () => {
    const { host, state } = stubHost({ stream: { 'status --short': ' M src/engine.c\n' } })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.aborted).toBe(true)
    expect(result.detail).toContain('local changes')
    expect(state.logged).toContain('!! /src/ninfer has local changes')
    // The abort stops the step: no fetch, no rebase, no build.
    expect(state.streamed.some((command) => command.includes('fetch'))).toBe(false)
    expect(state.streamed.some((command) => command.includes('rebase'))).toBe(false)
  })

  it('reports a failed git status', async () => {
    const { host, state } = stubHost({ fail: ['status --short'] })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('git status failed')
  })

  it('fetches origin and rebases onto the branch when the checkout is clean and no fork is provided', async () => {
    const { host, state } = stubHost()
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    const commands = state.streamed
    expect(commands.some((command) => command === 'git -C /src/ninfer fetch origin')).toBe(true)
    expect(
      commands.some((command) => command.includes('rebase origin/master')),
    ).toBe(true)
    expect(commands.some((command) => command.includes('remote add'))).toBe(false)
  })

  it('adds the fork under its remote name and rebases onto it when a fork is provided', async () => {
    const { host, state } = stubHost()
    const result = await syncEngineRepo(
      host,
      {
        engineId: 'infernix',
        directory: '/src/infernix',
        fork: 'https://github.com/me/infernix',
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    const commands = state.streamed
    expect(
      commands.some((command) =>
        command.includes(`remote add ${FORK_REMOTE} https://github.com/me/infernix`),
      ),
    ).toBe(true)
    expect(
      commands.some((command) => command === `git -C /src/infernix fetch ${FORK_REMOTE}`),
    ).toBe(true)
    expect(
      commands.some((command) => command.includes(`rebase ${FORK_REMOTE}/main`)),
    ).toBe(true)
  })

  it('updates the fork remote url when the add fails (the remote already exists)', async () => {
    const { host, state } = stubHost({ fail: ['remote add'] })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer', fork: 'https://github.com/me/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(
      state.streamed.some((command) =>
        command.includes(`remote set-url ${FORK_REMOTE} https://github.com/me/ninfer`),
      ),
    ).toBe(true)
  })

  it('reports a failed fetch', async () => {
    const { host, state } = stubHost({ fail: ['fetch origin'] })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('git fetch origin failed')
  })

  it('aborts the rebase and reports it when the rebase fails', async () => {
    const { host, state } = stubHost({ fail: ['rebase origin'] })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('git rebase origin/master failed')
    // The failing rebase is aborted, so the checkout keeps working.
    expect(state.logged).toContain('rebase --abort')
  })

  it('refuses an engine with no registered source', async () => {
    const { host, state } = stubHost()
    const result = await syncEngineRepo(
      host,
      { engineId: 'nope', directory: '/models/nope' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no engine source')
  })

  it('falls back to plain run when the host cannot stream', async () => {
    const { host, state } = stubHost({ exists: false, noStream: true })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/models/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(state.run.some((command) => command.startsWith('git clone'))).toBe(true)
    expect(state.streamed).toHaveLength(0)
    expect(state.logged).toContain('$ git clone')
  })

  it('prices a clean checkout through the plain-run fallback (no stdout reads as clean)', async () => {
    const { host, state } = stubHost({ noStream: true })
    const result = await syncEngineRepo(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(state.run.some((command) => command.includes('fetch origin'))).toBe(true)
  })
})

describe('buildEngineRepo', () => {
  it('runs the engine build steps with the checkout directory substituted', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(host, 'ninfer', '/src/ninfer', (chunk) => {
      state.logged += chunk
    })
    expect(result.ok).toBe(true)
    expect(state.logged).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
    expect(state.logged).not.toContain('{dir}')
  })

  it('reports a failed build step', async () => {
    const { host, state } = stubHost({ fail: ['cmake'] })
    const result = await buildEngineRepo(host, 'ninfer', '/src/ninfer', (chunk) => {
      state.logged += chunk
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('build failed')
  })

  it('runs the user build command instead of the engine default', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(
      host,
      'ninfer',
      '/src/ninfer',
      (chunk) => {
        state.logged += chunk
      },
      'cmake -S . -B build && cmake --build build',
    )
    expect(result.ok).toBe(true)
    // The user command runs in the checkout, wrapped with a cd into the dir.
    expect(state.logged).toContain('cd /src/ninfer && cmake -S . -B build && cmake --build build')
    // The engine default build step is not run.
    expect(state.logged).not.toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('runs the Windows build steps in the profile shell (powershell.exe)', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(
      host,
      'ninfer',
      '/src/ninfer',
      (chunk) => {
        state.logged += chunk
      },
      undefined,
      'windows',
    )
    expect(result.ok).toBe(true)
    // The Windows vcpkg route runs in the profile's powershell.exe shell, so
    // its $env: steps resolve; the git-free build step is the only command.
    expect(state.logged).toContain('vcpkg install')
    expect(state.streamedShells).toEqual(['powershell.exe'])
  })

  it('runs the Linux build steps in the host default shell (no profile shell)', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(host, 'ninfer', '/src/ninfer', (chunk) => {
      state.logged += chunk
    })
    expect(result.ok).toBe(true)
    // The Linux profile names no shell, so the host default runs the steps.
    expect(state.logged).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
    expect(state.streamedShells).toEqual([undefined])
  })

  it('passes through an engine with no local build steps', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(host, 'hyperqwen', '/src/vllm', (chunk) => {
      state.logged += chunk
    })
    expect(result.ok).toBe(true)
    expect(state.logged).toContain('no local build steps for hyperqwen')
  })

  it('refuses an engine with no registered source', async () => {
    const { host, state } = stubHost()
    const result = await buildEngineRepo(host, 'nope', '/models/nope', (chunk) => {
      state.logged += chunk
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no engine source')
  })
})

describe('syncAndRebuildEngine', () => {
  it('clones a missing checkout and builds it', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    expect(state.logged).toContain('cloning')
    expect(state.logged).toContain('git clone https://github.com/Neroued/ninfer /src/ninfer')
    expect(state.logged).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('rebases a clean checkout that is behind the remote and rebuilds it', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '3' } })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    expect(state.logged).toContain('is behind origin/master')
    expect(state.logged).toContain('git -C /src/ninfer checkout master')
    expect(state.logged).toContain('git -C /src/ninfer clean -fxd')
    expect(state.logged).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('skips the rebuild when the checkout is up to date with the remote', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '0' } })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(false)
    expect(state.logged).toContain('is up to date with origin/master')
    expect(state.logged).not.toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('skips the rebuild when the checkout has local changes', async () => {
    const { host, state } = stubHost({ stream: { 'status --short': ' M src/engine.c' } })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(false)
    expect(state.logged).toContain('has local changes')
    expect(state.logged).not.toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('rebases onto the fork remote when a fork is provided', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '3' } })
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'infernix',
        directory: '/src/infernix',
        fork: 'https://github.com/me/infernix',
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    expect(
      state.streamed.some((command) =>
        command.includes(`remote add ${FORK_REMOTE} https://github.com/me/infernix`),
      ),
    ).toBe(true)
    expect(state.logged).toContain('is behind dsh-fork/main')
  })

  it('links a rebuilt binary into /usr/local/bin when the trust gate is on', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '3' }, fail: ['command -v'] })
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'ninfer',
        directory: '/src/ninfer',
        allowRunDeps: true,
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    expect(state.logged).toContain(
      'sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve',
    )
  })

  it('writes the symlink command to the logs when the trust gate is off', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '3' }, fail: ['command -v'] })
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'ninfer',
        directory: '/src/ninfer',
        allowRunDeps: false,
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    // The gate is off, so the sudo link is written to the logs for the user
    // to run, with a note that the command must be on the path to launch.
    expect(state.logged).toContain(
      'sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve',
    )
    expect(state.logged).toContain('must be on the path to launch')
  })

  it('reports a failed build step', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '3' }, fail: ['cmake'] })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(false)
    expect(result.rebuilt).toBe(true)
    expect(result.detail).toContain('build failed')
  })

  it('fires onBuildStart the moment the build steps begin', async () => {
    const { host, state } = stubHost({ exists: false })
    let buildStartCalled = false
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'ninfer',
        directory: '/src/ninfer',
        onBuildStart: () => {
          buildStartCalled = true
        },
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    // The callback fires before the build steps run, so the caller can report
    // the "Building..." phase while the build is in flight.
    expect(buildStartCalled).toBe(true)
  })

  it('does not fire onBuildStart when no build runs (the checkout is current)', async () => {
    const { host, state } = stubHost({ stream: { 'rev-list': '0' } })
    let buildStartCalled = false
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'ninfer',
        directory: '/src/ninfer',
        onBuildStart: () => {
          buildStartCalled = true
        },
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(false)
    expect(buildStartCalled).toBe(false)
  })

  it('runs the user build command instead of the engine default', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncAndRebuildEngine(
      host,
      {
        engineId: 'ninfer',
        directory: '/src/ninfer',
        buildCommands: 'cmake -S . -B build && cmake --build build',
      },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    // The user command runs in the checkout, wrapped with a cd into the dir.
    expect(state.logged).toContain(
      'cd /src/ninfer && cmake -S . -B build && cmake --build build',
    )
    // The engine default build step is not run.
    expect(state.logged).not.toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('falls back to the engine default build steps when no build command is set', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    expect(state.logged).toContain('cmake -S /src/ninfer -B /src/ninfer/build')
  })

  it('runs the Windows build steps in the profile shell when the host OS is Windows', async () => {
    const { host, state } = stubHost({ exists: false })
    const result = await syncAndRebuildEngine(
      host,
      { engineId: 'ninfer', directory: '/src/ninfer', os: 'windows' },
      (chunk) => {
        state.logged += chunk
      },
    )
    expect(result.ok).toBe(true)
    expect(result.rebuilt).toBe(true)
    // The clone runs in the host's default shell; the vcpkg build step runs in
    // the profile's powershell.exe shell.
    const cloneIndex = state.streamed.findIndex((command) => command.startsWith('git clone'))
    expect(cloneIndex).toBeGreaterThan(-1)
    expect(state.streamedShells[cloneIndex]).toBeUndefined()
    const vcpkgIndex = state.streamed.findIndex((command) => command.includes('vcpkg install'))
    expect(vcpkgIndex).toBeGreaterThan(-1)
    expect(state.streamedShells[vcpkgIndex]).toBe('powershell.exe')
  })
})

describe('nodeLifecycleHost.runStream (the live streaming host)', () => {
  it('streams stdout chunks and reports a clean exit', async () => {
    const host = createNodeLifecycleHost()
    const chunks: string[] = []
    const result = await host.runStream?.('echo local-infer-stream-probe', (chunk) =>
      chunks.push(chunk),
    )
    expect(result?.ok).toBe(true)
    expect(chunks.join('')).toContain('local-infer-stream-probe')
  })

  it('reports a nonzero exit with the output tail as the detail', async () => {
    const host = createNodeLifecycleHost()
    const result = await host.runStream?.('echo noisy && exit 3', () => undefined)
    expect(result?.ok).toBe(false)
    expect(result?.detail).toContain('exit 3')
    expect(result?.detail).toContain('noisy')
  })

  it('streams stderr too (git writes its progress there)', async () => {
    const host = createNodeLifecycleHost()
    const chunks: string[] = []
    const result = await host.runStream?.('echo to-stderr >&2', (chunk) => chunks.push(chunk))
    expect(result?.ok).toBe(true)
    expect(chunks.join('')).toContain('to-stderr')
  })
})
