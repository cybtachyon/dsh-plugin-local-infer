/**
 * The Orchestrator prompt store tests: saved-file persistence, the shipped
 * prompt.md default resolved from both the source depth and the emitted
 * lib/ depth, and the effective-prompt holder. os.homedir() keys the saved
 * file, so each test points HOME at a scratch dir and never touches the
 * real one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  orchestratorConfigPath,
  readOrchestratorConfig,
  writeOrchestratorConfig,
} from '../src/config.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const promptPath = join(packageRoot, 'prompt.md')
const libConfigEntry = join(packageRoot, 'lib/config.js')

/**
 * ensureBuilt runs an incremental tsc -b when the orchestrator lib/ is
 * absent, so the emitted-depth tests work on a fresh checkout where pnpm
 * build has not run yet.
 */
function ensureBuilt(): void {
  if (existsSync(libConfigEntry)) return
  const repoRoot = resolve(packageRoot, '..', '..')
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '-b', repoRoot], { stdio: 'inherit' })
}

/**
 * loadStore returns a fresh copy of the store module so each holder test
 * starts with an empty effective-prompt cache.
 */
async function loadStore(): Promise<typeof import('../src/config.ts')> {
  vi.resetModules()
  return import('../src/config.ts')
}

beforeAll(ensureBuilt)

let home: string

beforeEach(() => {
  // readOrchestratorConfig and writeOrchestratorConfig key the file on
  // homedir(); HOME covers POSIX and USERPROFILE covers Windows.
  home = mkdtempSync(join(tmpdir(), 'orchestrator-config-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('orchestrator config persistence', () => {
  it('reads a missing file as no saved prompt', () => {
    expect(readOrchestratorConfig()).toEqual({ prompt: '' })
  })

  it('round-trips a saved prompt through the file', () => {
    writeOrchestratorConfig({ prompt: 'first line\nsecond line' })
    const raw = JSON.parse(readFileSync(orchestratorConfigPath(), 'utf8')) as { prompt?: unknown }
    expect(raw.prompt).toBe('first line\nsecond line')
    expect(readOrchestratorConfig().prompt).toBe('first line\nsecond line')
  })

  it('falls back to no saved prompt on a broken file or an off-type field', () => {
    const path = orchestratorConfigPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{not json')
    expect(readOrchestratorConfig().prompt).toBe('')
    writeFileSync(path, '{"prompt": 7}')
    expect(readOrchestratorConfig().prompt).toBe('')
    writeFileSync(path, 'null')
    expect(readOrchestratorConfig().prompt).toBe('')
  })
})

describe('effective prompt holder', () => {
  it('uses the shipped prompt.md while nothing is saved', async () => {
    const store = await loadStore()
    expect(store.getOrchestratorPrompt()).toBe(readFileSync(promptPath, 'utf8'))
    expect(existsSync(orchestratorConfigPath())).toBe(false)
  })

  it('persists and refreshes on set', async () => {
    const store = await loadStore()
    store.setOrchestratorPrompt('edited prompt')
    const raw = JSON.parse(readFileSync(orchestratorConfigPath(), 'utf8')) as { prompt?: unknown }
    expect(raw.prompt).toBe('edited prompt')
    expect(store.getOrchestratorPrompt()).toBe('edited prompt')
    expect(readOrchestratorConfig().prompt).toBe('edited prompt')
  })

  it('reads a saved prompt from the file on the first get', async () => {
    writeOrchestratorConfig({ prompt: 'saved before mount' })
    const store = await loadStore()
    expect(store.getOrchestratorPrompt()).toBe('saved before mount')
  })

  it('falls back to the shipped default when the save is empty', async () => {
    const store = await loadStore()
    store.setOrchestratorPrompt('')
    expect(store.getOrchestratorPrompt()).toBe(readFileSync(promptPath, 'utf8'))
  })
})

describe('defaultOrchestratorPrompt', () => {
  it('resolves the package prompt.md from the source depth', async () => {
    const store = await loadStore()
    const expected = readFileSync(promptPath, 'utf8')
    expect(store.defaultOrchestratorPrompt()).toBe(expected)
    // The read is cached: the second call returns the same text.
    expect(store.defaultOrchestratorPrompt()).toBe(expected)
  })

  it('resolves the package prompt.md from the emitted lib entry', async () => {
    const emitted = await import('../lib/index.js')
    expect(emitted.defaultOrchestratorPrompt()).toBe(readFileSync(promptPath, 'utf8'))
  })

  it('yields the empty string when prompt.md is unreadable', async () => {
    // A lone copy of the emitted module one dir deep has no ../prompt.md
    // beside it, exercising the no-throw fallback from a foreign depth.
    const scratch = mkdtempSync(join(tmpdir(), 'orchestrator-stray-'))
    const strayDir = join(scratch, 'pkg')
    mkdirSync(strayDir)
    // Strip the sourcemap pointer so vite does not chase a map beside the copy.
    const source = readFileSync(libConfigEntry, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '')
    writeFileSync(join(strayDir, 'config.js'), source)
    const stray = await import(pathToFileURL(join(strayDir, 'config.js')).href)
    expect(stray.defaultOrchestratorPrompt()).toBe('')
    rmSync(scratch, { recursive: true, force: true })
  })
})
