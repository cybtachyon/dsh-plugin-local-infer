import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  dshConfigCacheDirectory,
  dshEngineCacheDirectory,
  dshInferCacheDirectory,
  hfDownloadResultDirectory,
} from '../src/infer-cache.ts'

// The path builders key on homedir(), so the suite points the home at a
// literal and never touches the real one. homedir() reads HOME on POSIX and
// USERPROFILE on Windows, so both are set.
const HOME = '/home/test-user'
let savedHome: string | undefined
let savedUserProfile: string | undefined

beforeAll(() => {
  savedHome = process.env.HOME
  savedUserProfile = process.env.USERPROFILE
  process.env.HOME = HOME
  process.env.USERPROFILE = HOME
})

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
})

describe('dshInferCacheDirectory', () => {
  it('resolves the plugin cache root under the user home', () => {
    expect(dshInferCacheDirectory()).toBe(join(HOME, '.cache', 'dsh', 'infer'))
  })
})

describe('dshEngineCacheDirectory', () => {
  it('places one engine checkout under the cache root', () => {
    expect(dshEngineCacheDirectory('basalt')).toBe(
      join(HOME, '.cache', 'dsh', 'infer', 'basalt'),
    )
  })
})

describe('dshConfigCacheDirectory', () => {
  it('places engine config files in the config home under the cache root', () => {
    expect(dshConfigCacheDirectory()).toBe(
      join(HOME, '.cache', 'dsh', 'infer', 'config'),
    )
  })
})

describe('hfDownloadResultDirectory', () => {
  // A scratch hub cache with one snapshot holding the artifact, mirroring
  // the models--{ns}--{name}/snapshots/{commit}/{file} layout the hf CLI
  // writes without --local-dir.
  let hubCache = ''
  const commit = '21b8357546172bf19a685ccf3353e7da7aeadde0'
  const file = 'model-NVFP4.safetensors'

  beforeAll(() => {
    hubCache = mkdtempSync(join(tmpdir(), 'infer-cache-hf-'))
    const dir = join(hubCache, 'models--jesdga--Qwen3.8-Flash-Next-Basalt', 'snapshots', commit)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, file), 'weights')
  })

  afterAll(() => {
    rmSync(hubCache, { recursive: true, force: true })
  })

  it('resolves the snapshot directory holding the artifact', () => {
    expect(
      hfDownloadResultDirectory(
        hubCache,
        'jesdga/Qwen3.8-Flash-Next-Basalt',
        file,
      ),
    ).toBe(join(hubCache, 'models--jesdga--Qwen3.8-Flash-Next-Basalt', 'snapshots', commit))
  })

  it('returns null when no snapshot holds the artifact', () => {
    expect(
      hfDownloadResultDirectory(
        hubCache,
        'jesdga/Qwen3.8-Flash-Next-Basalt',
        'absent.gguf',
      ),
    ).toBeNull()
  })

  it('returns null for an unknown repo', () => {
    expect(
      hfDownloadResultDirectory(hubCache, 'nobody/nothing-repo', file),
    ).toBeNull()
  })

  it('returns null for a blank file (a whole-repo download names no snapshot)', () => {
    expect(
      hfDownloadResultDirectory(
        hubCache,
        'jesdga/Qwen3.8-Flash-Next-Basalt',
        '',
      ),
    ).toBeNull()
  })
})
