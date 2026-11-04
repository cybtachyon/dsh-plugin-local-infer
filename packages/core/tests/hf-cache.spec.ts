import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  hfDatasetsCacheDirectory,
  hfHubCacheDirectory,
} from '../src/hf-cache.ts'

// The resolver keys on homedir(), so the suite points the home at a literal
// and never touches the real one. homedir() reads HOME on POSIX and
// USERPROFILE on Windows, so both are set.
const HOME = '/home/test-user'
const HF_KEYS = ['HF_HOME', 'HF_HUB_CACHE', 'HF_DATASETS_CACHE'] as const
const savedEnv = {} as Record<(typeof HF_KEYS)[number], string | undefined>

beforeAll(() => {
  for (const key of HF_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.HOME = HOME
  process.env.USERPROFILE = HOME
})

afterEach(() => {
  // A test that arms an override clears it for the next test, so the
  // platform-default tests never read a leaked value.
  for (const key of HF_KEYS) delete process.env[key]
})

afterAll(() => {
  for (const key of HF_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('hfHubCacheDirectory', () => {
  it('resolves the platform default under the user home', () => {
    expect(hfHubCacheDirectory()).toBe(join(HOME, '.cache', 'huggingface', 'hub'))
  })

  it('moves the hub cache under an HF_HOME global override', () => {
    process.env.HF_HOME = '/srv/hf'
    expect(hfHubCacheDirectory()).toBe(join('/srv/hf', 'hub'))
  })

  it('lets an HF_HUB_CACHE override win over HF_HOME', () => {
    process.env.HF_HOME = '/srv/hf'
    process.env.HF_HUB_CACHE = '/mnt/models'
    expect(hfHubCacheDirectory()).toBe('/mnt/models')
  })

  it('reads a blank override as unset', () => {
    process.env.HF_HUB_CACHE = '   '
    expect(hfHubCacheDirectory()).toBe(join(HOME, '.cache', 'huggingface', 'hub'))
  })
})

describe('hfDatasetsCacheDirectory', () => {
  it('resolves the platform default under the user home', () => {
    expect(hfDatasetsCacheDirectory()).toBe(join(HOME, '.cache', 'huggingface', 'datasets'))
  })

  it('moves the datasets cache under an HF_HOME global override', () => {
    process.env.HF_HOME = '/srv/hf'
    expect(hfDatasetsCacheDirectory()).toBe(join('/srv/hf', 'datasets'))
  })

  it('lets an HF_DATASETS_CACHE override win over HF_HOME', () => {
    process.env.HF_HOME = '/srv/hf'
    process.env.HF_DATASETS_CACHE = '/mnt/data'
    expect(hfDatasetsCacheDirectory()).toBe('/mnt/data')
  })

  it('keeps the two stores independent when both overrides are set', () => {
    process.env.HF_HOME = '/srv/hf'
    process.env.HF_HUB_CACHE = '/mnt/models'
    process.env.HF_DATASETS_CACHE = '/mnt/data'
    expect(hfHubCacheDirectory()).toBe('/mnt/models')
    expect(hfDatasetsCacheDirectory()).toBe('/mnt/data')
  })
})
