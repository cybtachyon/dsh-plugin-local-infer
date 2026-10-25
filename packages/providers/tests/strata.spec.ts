import { describe, expect, it } from 'vitest'
import {
  STRATA_ACCESS_OPTIONS,
  STRATA_FAMILY_OPTIONS,
  STRATA_PARAMETERS,
  STRATA_TUNE_OPTIONS,
  STRATA_VISION_OPTIONS,
  strataModelKey,
} from '../src/engines/strata.ts'

describe('Strata parameter surface', () => {
  it('ships the strata launch flag surface, one spec per flag', () => {
    const keys = STRATA_PARAMETERS.map((spec) => spec.key)
    expect(keys).toEqual([
      'port',
      'family',
      'context',
      'vision',
      'parallel',
      'gpu',
      'tune',
      'access',
      'apiKey',
      'modelPath',
      'dataDir',
    ])
  })

  it('spells both a toArgv flag and a toEnv variable for the shared specs', () => {
    const byKey = Object.fromEntries(STRATA_PARAMETERS.map((spec) => [spec.key, spec]))
    // The specs with a docker counterpart carry both spellings.
    for (const key of ['family', 'context', 'vision', 'parallel', 'gpu', 'tune', 'apiKey', 'modelPath']) {
      expect(byKey[key]?.toArgv).toBeTypeOf('function')
      expect(byKey[key]?.toEnv).toBeTypeOf('function')
    }
    // The port is spelled by the adapter, and access and dataDir have no docker
    // counterpart, so they carry no toEnv.
    expect(byKey['port']?.toEnv).toBeUndefined()
    expect(byKey['access']?.toEnv).toBeUndefined()
    expect(byKey['dataDir']?.toEnv).toBeUndefined()
  })

  it('offers the model family, vision, tune, and access options', () => {
    expect(STRATA_FAMILY_OPTIONS.map((option) => option.value)).toEqual([
      'qwen',
      'swift',
      'coder',
      'unsloth',
    ])
    expect(STRATA_VISION_OPTIONS.map((option) => option.value)).toEqual(['off', 'on', 'gpu', 'cpu'])
    expect(STRATA_TUNE_OPTIONS.map((option) => option.value)).toEqual(['skip', 'quick', 'thorough'])
    expect(STRATA_ACCESS_OPTIONS.map((option) => option.value)).toEqual([
      'local',
      'lan',
      'cloudflare',
      'tailscale',
    ])
  })

  it('reads the model key from the config, falling back to an empty string', () => {
    expect(strataModelKey({ model: 'iq3_s' })).toBe('iq3_s')
    expect(strataModelKey({})).toBe('')
  })

  it('spells the toArgv flags and toEnv variables for a representative value', () => {
    const byKey = Object.fromEntries(STRATA_PARAMETERS.map((spec) => [spec.key, spec]))
    expect(byKey['family']?.toArgv?.('coder')).toEqual(['--family', 'coder'])
    expect(byKey['family']?.toEnv?.('coder')).toEqual(['FAMILY', 'coder'])
    expect(byKey['context']?.toArgv?.('128k')).toEqual(['--context', '128k'])
    expect(byKey['context']?.toEnv?.('128k')).toEqual(['CONTEXT', '128k'])
    expect(byKey['vision']?.toArgv?.('gpu')).toEqual(['--vision', 'gpu'])
    expect(byKey['vision']?.toEnv?.('gpu')).toEqual(['VISION', 'gpu'])
    expect(byKey['parallel']?.toArgv?.(4)).toEqual(['--parallel', '4'])
    expect(byKey['parallel']?.toEnv?.(4)).toEqual(['PARALLEL', '4'])
    expect(byKey['gpu']?.toArgv?.('0,1')).toEqual(['--gpu', '0,1'])
    expect(byKey['gpu']?.toEnv?.('0,1')).toEqual(['GPU', '0,1'])
    expect(byKey['tune']?.toArgv?.('quick')).toEqual(['--tune', 'quick'])
    expect(byKey['tune']?.toEnv?.('quick')).toEqual(['TUNE', 'quick'])
    expect(byKey['access']?.toArgv?.('lan')).toEqual(['--access', 'lan'])
    // local is the default, so it spells no flag.
    expect(byKey['access']?.toArgv?.('local')).toEqual([])
    expect(byKey['apiKey']?.toArgv?.('abc')).toEqual(['--api-key', 'abc'])
    expect(byKey['apiKey']?.toEnv?.('abc')).toEqual(['API_KEY', 'abc'])
    expect(byKey['modelPath']?.toArgv?.('/models')).toEqual(['--model-path', '/models'])
    expect(byKey['modelPath']?.toEnv?.('/models')).toEqual(['MODEL_PATH', '/models'])
    expect(byKey['dataDir']?.toArgv?.('/data')).toEqual(['--data-dir', '/data'])
    // A falsy value spells no flag for the optional specs.
    expect(byKey['context']?.toArgv?.('')).toEqual([])
    expect(byKey['gpu']?.toArgv?.('')).toEqual([])
  })
})
