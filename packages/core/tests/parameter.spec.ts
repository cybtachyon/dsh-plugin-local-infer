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

  it('accepts a list of deploy targets on one spec', () => {
    // A multi-target deploy (the Strata shared specs): the value lands on the
    // cli in the binary mode and in the env in the docker mode.
    const targets: readonly ParameterDeploy[] = [{ target: 'cli' }, { target: 'env' }]
    const spec: ParameterSpec = {
      key: 'family',
      label: 'Model family',
      description: 'The model family the engine serves.',
      form: { kind: 'text' },
      deploy: targets,
    }
    expect(spec.deploy).toEqual(targets)
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
