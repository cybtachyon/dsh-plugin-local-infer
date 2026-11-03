import { describe, expect, it } from 'vitest'
import type { ParameterDeploy, ParameterSpec } from '../src/index.ts'

describe('ParameterSpec deploy target', () => {
  it('accepts a config deploy target with format, block, and key', () => {
    const deploy: ParameterDeploy = {
      target: 'config',
      format: 'json',
      block: 'engine',
      key: 'threads',
    }
    const spec: ParameterSpec = {
      key: 'threads',
      label: 'Threads',
      description: 'Worker threads the engine uses.',
      form: { kind: 'number', min: 1 },
      deploy,
      toConfig: (value) => value,
    }
    expect(spec.deploy).toEqual(deploy)
    expect(spec.toConfig?.(4)).toBe(4)
  })

  it('accepts the cli and env deploy targets', () => {
    const cli: ParameterDeploy = { target: 'cli' }
    const env: ParameterDeploy = { target: 'env' }
    const spec: ParameterSpec = {
      key: 'verbose',
      label: 'Verbose',
      description: 'Prints engine logs.',
      form: { kind: 'boolean' },
      deploy: env,
    }
    expect(cli).toEqual({ target: 'cli' })
    expect(spec.deploy).toEqual(env)
  })

  it('leaves deploy and toConfig absent on a plain spec', () => {
    const spec: ParameterSpec = {
      key: 'port',
      label: 'Port',
      description: 'Port the server listens on.',
      form: { kind: 'number', min: 1, max: 65535, slider: false },
    }
    expect(spec.deploy).toBeUndefined()
    expect(spec.toConfig).toBeUndefined()
  })
})
