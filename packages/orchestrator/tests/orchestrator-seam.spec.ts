/**
 * The systemPrompt seam tests: a scoped inject whose seam never arrives
 * registers nothing and never throws, and a recording systemPrompt service
 * receives exactly one global `orchestrator` section whose text provider
 * follows the effective-prompt holder, so a Save reaches the next assembly
 * without a restart. os.homedir() keys the saved prompt file, so each test
 * points HOME at a scratch dir and never touches the real one.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const promptPath = join(packageRoot, 'prompt.md')

/** One section handed to the recording systemPrompt service. */
interface RecordedSection {
  name: string
  order: number
  text: string | (() => string)
  interpolate?: boolean
}

/**
 * makeSeamScope returns the fake `systemPrompt` service and the sections it
 * recorded. A throwing registry exercises the skipped-section catch.
 */
function makeSeamScope(throwOnSection = false) {
  const sections: RecordedSection[] = []
  const scope = {
    systemPrompt: {
      section(section: RecordedSection): () => void {
        if (throwOnSection) {
          throw new Error('section registry unavailable')
        }
        sections.push(section)
        return () => {
          /* the effect disposer unregisters; the test owns the list */
        }
      },
    },
  }
  return { scope, sections }
}

/**
 * withFakeInject swaps a real Context's inject for `impl`, the way the ui
 * spec fakes the webServer seam: apply() sees a normal context, and the
 * impl decides whether and with what scope the callback runs.
 */
function withFakeInject(
  impl: (names: string[], cb: (scope: unknown) => void) => void,
): Context {
  const ctx = new Context()
  ;(
    ctx as unknown as { inject: (names: string[], cb: (scope: unknown) => void) => void }
  ).inject = impl
  return ctx
}

/**
 * loadFresh returns a fresh copy of the plugin module (and, with it, of the
 * config holder) so each seam test starts with an empty effective-prompt
 * cache.
 */
async function loadFresh(): Promise<typeof import('../src/index.ts')> {
  vi.resetModules()
  return import('../src/index.ts')
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orchestrator-seam-'))
  // HOME covers POSIX and USERPROFILE covers Windows for homedir().
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('systemPrompt seam', () => {
  it('registers nothing when the seam never arrives', async () => {
    const mod = await loadFresh()
    const { sections } = makeSeamScope()
    const requested: string[][] = []
    const ctx = withFakeInject((names, _cb) => {
      requested.push(names)
      // The seam is absent in this profile: cordis never runs the callback.
    })
    expect(() => mod.apply(ctx)).not.toThrow()
    expect(requested).toEqual([['systemPrompt']])
    expect(sections).toEqual([])
  })

  it('is a no-op on a context without an inject', async () => {
    const mod = await loadFresh()
    expect(() => mod.apply({} as Context)).not.toThrow()
  })

  it('registers one orchestrator section with the default prompt before any save', async () => {
    const mod = await loadFresh()
    const { scope, sections } = makeSeamScope()
    mod.apply(withFakeInject((_names, cb) => cb(scope)))
    expect(sections.length).toBe(1)
    const [section] = sections
    expect(section?.name).toBe('orchestrator')
    expect(section?.order).toBe(100)
    expect(section?.interpolate).toBe(false)
    // A provider, evaluated per assembly: before any save it resolves to
    // the shipped prompt.md default.
    expect(typeof section?.text).toBe('function')
    expect(section?.text()).toBe(readFileSync(promptPath, 'utf8'))
  })

  it('follows the holder after a setOrchestratorPrompt update', async () => {
    const mod = await loadFresh()
    const { scope, sections } = makeSeamScope()
    mod.apply(withFakeInject((_names, cb) => cb(scope)))
    const [section] = sections
    expect(section?.text()).toBe(readFileSync(promptPath, 'utf8'))
    mod.setOrchestratorPrompt('edited orchestrator prompt')
    expect(section?.text()).toBe('edited orchestrator prompt')
  })

  it('swallows a section-registration failure so the component still loads', async () => {
    const mod = await loadFresh()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      /* the inject catch logs and continues */
    })
    const { scope } = makeSeamScope(true)
    expect(() => mod.apply(withFakeInject((_names, cb) => cb(scope)))).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('orchestrator prompt section skipped'))
    error.mockRestore()
  })
})
