import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  hfDatasetsCacheDirectory,
  hfHubCacheDirectory,
  modelDownloadTarget,
  resolveModelDirectory,
} from '../src/hf-cache.ts'
import type { ModelDownloadSource } from '../src/models.ts'

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

describe('modelDownloadTarget', () => {
  it('keeps a named directory as the flat --local-dir base', () => {
    expect(modelDownloadTarget('/models', '/hub')).toEqual({
      baseDir: '/models',
      useHubCache: false,
    })
  })

  it('reads an absent or blank directory as the hub-cache layout over the caller hub root', () => {
    expect(modelDownloadTarget(undefined, '/hub')).toEqual({
      baseDir: '/hub',
      useHubCache: true,
    })
    expect(modelDownloadTarget('', '/hub')).toEqual({ baseDir: '/hub', useHubCache: true })
    // The shared override predicate trims, so a whitespace-only field names
    // no directory either.
    expect(modelDownloadTarget('   ', '/hub')).toEqual({ baseDir: '/hub', useHubCache: true })
  })

  it('falls back to the env-resolved hub cache when the caller names no root', () => {
    expect(modelDownloadTarget(undefined).baseDir).toBe(
      join(HOME, '.cache', 'huggingface', 'hub'),
    )
  })

  it('reads a non-string field as no override', () => {
    expect(modelDownloadTarget(42, '/hub')).toEqual({ baseDir: '/hub', useHubCache: true })
  })
})

describe('resolveModelDirectory', () => {
  const SOURCE: ModelDownloadSource = {
    url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
    file: 'qwen3_8_27b_nvfp4.ninfer',
  }
  const WHOLE_REPO: ModelDownloadSource = {
    url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
  }
  const root = mkdtempSync(join(tmpdir(), 'hf-cache-resolve-'))
  const hub = join(root, 'hub')
  const snapshot = join(hub, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer', 'snapshots', 'cafebabe')
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps a named directory over a cached snapshot', () => {
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    expect(resolveModelDirectory('/models', SOURCE, hub)).toEqual({
      baseDir: '/models',
      directory: '/models',
      useHubCache: false,
    })
  })

  it('resolves the hub-cache layout to the snapshot holding the cached artifact', () => {
    expect(resolveModelDirectory(undefined, SOURCE, hub)).toEqual({
      baseDir: hub,
      directory: snapshot,
      useHubCache: true,
    })
  })

  it('falls back to the hub cache root when nothing is cached or no source names one', () => {
    rmSync(join(root, 'hub'), { recursive: true, force: true })
    expect(resolveModelDirectory(undefined, SOURCE, hub)).toEqual({
      baseDir: hub,
      directory: hub,
      useHubCache: true,
    })
    expect(resolveModelDirectory(undefined, undefined, hub)).toEqual({
      baseDir: hub,
      directory: hub,
      useHubCache: true,
    })
    // A whole-repo source names no single artifact, so it resolves to the
    // hub root too (the hf CLI picks its own snapshot destination).
    expect(resolveModelDirectory(undefined, WHOLE_REPO, hub)).toEqual({
      baseDir: hub,
      directory: hub,
      useHubCache: true,
    })
  })
})
