import { describe, expect, it } from 'vitest'
import {
  ENGINE_SOURCES,
  FORK_REMOTE,
  buildEngineRepo,
  engineBuildSteps,
  engineSource,
  syncEngineRepo,
} from '../src/acquire.ts'
import { ENGINES } from '../src/engines.ts'
import { createNodeLifecycleHost } from '../src/adapters.ts'
import type { CommandOutcome, LifecycleHost } from '../../core/lib/index.js'

/**
 * A stub LifecycleHost for the Get steps. `exists` decides whether the
 * `[ -d <dir>/.git ]` probe finds a checkout; `stream` feeds the stdout a
 * streamed command prints (the dirty-check reads it); `fail` lists command
 * substrings whose run fails. Every command and every streamed chunk is
 * recorded so the assertions read the sequence.
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
    async run(command: string): Promise<CommandOutcome> {
      state.run.push(command)
      if (command.startsWith('[ -d')) {
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
          ): Promise<CommandOutcome> {
            state.streamed.push(command)
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
