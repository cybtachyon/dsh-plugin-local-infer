import { describe, expect, it } from 'vitest'
import { formatLaunchCommand } from '../src/index.ts'
import type { LaunchPlan } from '../src/index.ts'

function plan(overrides: Partial<LaunchPlan>): LaunchPlan {
  return {
    engineId: 'infernix',
    kind: 'process',
    port: 18080,
    healthUrl: 'http://127.0.0.1:18080/health',
    ...overrides,
  }
}

describe('formatLaunchCommand', () => {
  it('joins a process plan argv into the shell command line', () => {
    const command = formatLaunchCommand(
      plan({
        argv: [
          'infernix-serve',
          '/opt/hf-models/Qwen3.8-Flash-Next-NVFP4.infernix',
          '--host',
          '127.0.0.1',
          '--port',
          '18080',
          '--kv-dtype',
          'nvfp4',
          '--vision',
          '--temperature',
          '0.9',
        ],
      }),
    )
    expect(command).toBe(
      'infernix-serve /opt/hf-models/Qwen3.8-Flash-Next-NVFP4.infernix ' +
        '--host 127.0.0.1 --port 18080 --kv-dtype nvfp4 --vision --temperature 0.9',
    )
  })

  it('joins a docker plan argv so the printed line is the docker run', () => {
    const command = formatLaunchCommand(
      plan({
        engineId: 'ninfer',
        kind: 'docker',
        argv: ['docker', 'run', '--rm', '-p', '18020:18020', 'ghcr.io/example/ninfer:latest'],
      }),
    )
    expect(command).toBe('docker run --rm -p 18020:18020 ghcr.io/example/ninfer:latest')
  })

  it('quotes tokens a bare shell word cannot carry', () => {
    const command = formatLaunchCommand(
      plan({ argv: ['llama-server', '--model', '/home/me/my models/m.gguf', '--alias', "it's"] }),
    )
    expect(command).toBe(
      `llama-server --model '/home/me/my models/m.gguf' --alias 'it'\\''s'`,
    )
  })

  it('spells the compose up line for a compose plan', () => {
    const command = formatLaunchCommand(
      plan({ engineId: 'hyperqwen', kind: 'compose', composeFile: 'compose.yml', profile: 'two' }),
    )
    expect(command).toBe('docker compose -f compose.yml --profile two up --pull always -d')
  })

  it('falls back to the compose defaults for a bare compose plan', () => {
    const command = formatLaunchCommand(plan({ engineId: 'hyperqwen', kind: 'compose' }))
    expect(command).toBe('docker compose -f docker-compose.yml --profile single up --pull always -d')
  })

  it('appends the user compose arguments before the required up -d', () => {
    const command = formatLaunchCommand(
      plan({
        engineId: 'hyperqwen',
        kind: 'compose',
        composeFile: 'compose.yml',
        composeArgs: '--profile batch --some-flag',
      }),
    )
    expect(command).toBe('docker compose -f compose.yml --profile batch --some-flag up -d')
  })

  it('keeps the default profile when the compose arguments are blank', () => {
    const command = formatLaunchCommand(
      plan({
        engineId: 'hyperqwen',
        kind: 'compose',
        composeFile: 'compose.yml',
        profile: 'two',
        composeArgs: '   ',
      }),
    )
    expect(command).toBe('docker compose -f compose.yml --profile two up --pull always -d')
  })

  it('reads a plan with no argv as no command', () => {
    expect(formatLaunchCommand(plan({}))).toBeUndefined()
    expect(formatLaunchCommand(plan({ argv: [] }))).toBeUndefined()
  })
})
