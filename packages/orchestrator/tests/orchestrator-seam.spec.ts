/**
 * The systemPrompt seam tests: a scoped inject whose seam never arrives
 * registers nothing and never throws, and a recording systemPrompt service
 * receives exactly one global `orchestrator` section whose text provider
 * follows the effective-prompt holder, so a Save reaches the next assembly
 * without a restart. The gate tests pin the primary-agent rule: the section
 * text lands for an assembly scoped to a live root agent, and an assembly
 * scoped to anything else lands empty; a registry-free profile and a
 * zero-arg assembly keep receiving the prompt. os.homedir() keys the saved
 * prompt file, so each test points HOME at a scratch dir and never touches
 * the real one.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const promptPath = join(packageRoot, 'prompt.md')
// Shipped prompt.md text: the single expectation for every un-saved assembly.
const shippedPrompt = readFileSync(promptPath, 'utf8')

/** One section handed to the recording systemPrompt service. */
interface RecordedSection {
  name: string
  order: number
  text: string | ((assembly?: { scope?: object }) => string)
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
 * fireForAll returns an inject impl that runs each seam's callback with the
 * scope named for it in `scopes` and leaves every seam that `scopes` does
 * not name absent, so a spec mounts exactly the profile seams it tests.
 */
function fireForAll(scopes: Record<string, unknown>) {
  return (names: string[], cb: (scope: unknown) => void): void => {
    const scope = scopes[names[0]]
    if (scope !== undefined) {
      cb(scope)
    }
  }
}

/**
 * textFor calls a recorded section's text provider the way
 * dsh-system-prompt does: once per assembly, with that assembly's agent
 * scope object, or with no argument for a global unscoped assembly.
 */
function textFor(section: RecordedSection | undefined, scope?: object): string {
  const text = section?.text
  if (typeof text !== 'function') {
    throw new Error('the test profile registered no text provider')
  }
  return scope === undefined ? text() : text({ scope })
}

/**
 * mountGate mounts the plugin in a gate profile: the `agents` and
 * `systemPrompt` seams both arrive, `webServer` stays absent, and the
 * registry roots are the caller's array. Returns the recorded sections and
 * that mutable roots list.
 */
async function mountGate(rootAgents: object[]) {
  const mod = await loadFresh()
  const { scope: promptScope, sections } = makeSeamScope()
  // Fake `agents` service: roots() views the caller's array live, so a gate
  // test can flip registry membership between section.text() calls.
  const agentsScope = { agents: { roots: () => rootAgents } }
  mod.apply(
    withFakeInject(fireForAll({ agents: agentsScope, systemPrompt: promptScope })),
  )
  return { sections, rootAgents }
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
    expect(requested).toEqual([['agents'], ['systemPrompt'], ['webServer']])
    expect(sections).toEqual([])
  })

  it('is a no-op on a context without an inject', async () => {
    const mod = await loadFresh()
    expect(() => mod.apply({} as Context)).not.toThrow()
  })

  it('registers one orchestrator section with the default prompt before any save', async () => {
    const mod = await loadFresh()
    const { scope, sections } = makeSeamScope()
    mod.apply(withFakeInject(fireForAll({ systemPrompt: scope })))
    expect(sections.length).toBe(1)
    const [section] = sections
    expect(section?.name).toBe('orchestrator')
    expect(section?.order).toBe(100)
    expect(section?.interpolate).toBe(false)
    // A provider, evaluated per assembly: before any save it resolves to
    // the shipped prompt.md default.
    expect(typeof section?.text).toBe('function')
    expect(section?.text()).toBe(shippedPrompt)
  })

  it('follows the holder after a setOrchestratorPrompt update', async () => {
    const mod = await loadFresh()
    const { scope, sections } = makeSeamScope()
    mod.apply(withFakeInject(fireForAll({ systemPrompt: scope })))
    const [section] = sections
    expect(section?.text()).toBe(shippedPrompt)
    mod.setOrchestratorPrompt('edited orchestrator prompt')
    expect(section?.text()).toBe('edited orchestrator prompt')
  })

  it('swallows a section-registration failure so the component still loads', async () => {
    const mod = await loadFresh()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      /* the inject catch logs and continues */
    })
    const { scope } = makeSeamScope(true)
    expect(() =>
      mod.apply(withFakeInject(fireForAll({ systemPrompt: scope }))),
    ).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('orchestrator prompt section skipped'))
    error.mockRestore()
  })
})

describe('primary-agent gate', () => {
  it('returns the prompt for an assembly scoped to a root agent', async () => {
    const rootAgent = { agent: 'primary' }
    const { sections } = await mountGate([rootAgent])
    expect(textFor(sections[0], rootAgent)).toBe(shippedPrompt)
  })

  it('returns an empty text for an assembly scoped to a sub-agent', async () => {
    const subAgent = { agent: 'sub' }
    const { sections } = await mountGate([{ agent: 'primary' }])
    expect(textFor(sections[0], subAgent)).toBe('')
  })

  it('keeps injecting for any scope when the agents seam never arrives', async () => {
    const mod = await loadFresh()
    const { scope, sections } = makeSeamScope()
    mod.apply(withFakeInject(fireForAll({ systemPrompt: scope })))
    expect(textFor(sections[0], { agent: 'unregistered' })).toBe(shippedPrompt)
  })

  it('returns the prompt for a zero-arg assembly while the registry is present', async () => {
    const { sections } = await mountGate([{ agent: 'primary' }])
    expect(textFor(sections[0])).toBe(shippedPrompt)
  })

  it('re-reads roots() per assembly instead of caching the first answer', async () => {
    const lateAgent = { agent: 'late' }
    const { sections, rootAgents } = await mountGate([])
    expect(textFor(sections[0], lateAgent)).toBe('')
    rootAgents.push(lateAgent)
    expect(textFor(sections[0], lateAgent)).toBe(shippedPrompt)
  })
})
