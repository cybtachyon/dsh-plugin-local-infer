import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from 'dsh-plugin-local-infer/client'

/**
 * The bootstrap source (plugin.ts) drives apply through the two optional
 * seams (the locale and slots scoped injects) and, on a successful route
 * probe, mounts the card into both slots. The orchestrator card rides a
 * second, independent probe issued in the same slots inject: its route
 * belongs to the disabled-by-default orchestrator component row, and it
 * registers into plugins.row.config (the keyed plugins.bundle.config cell is
 * the Engine card's alone). This suite drives the source
 * directly: react resolves from the repo's devDependency (the DSH shell's
 * React 18), and the primitives seed is absent here, so its require falls
 * back to null and the card keeps its native controls. The carrier suite
 * (carrier.spec.ts) covers the primitives-present and react-absent branches
 * through the generated artifact, where the factory's injected require is
 * stubbed.
 */

// The host locale seam hands the card a LocaleRuntime (getSnapshot().active
// plus subscribe), not a bare string. The scope models that service shape.
interface Scope {
  locale:
    | {
        getSnapshot: () => { active: string }
        subscribe: (listener: () => void) => () => void
      }
    | undefined
  effect?: (disposer: () => void, label?: string) => void
  slots: {
    inject: (name: string, body: () => void) => void
    register: (
      spec: { name: string; key?: string; id?: string; order?: number },
      component: unknown,
    ) => unknown
  }
}

type ApplyCtx = Parameters<typeof apply>[0]

// A slots scope that runs each injected body so register is captured.
function makeScope(registrations: unknown[], withEffect = true): Scope {
  return {
    locale: {
      getSnapshot: () => ({ active: 'en' }),
      subscribe: () => () => {},
    },
    ...(withEffect
      ? { effect: (disposer: () => void) => { disposer() } }
      : {}),
    slots: {
      inject: (_name: string, body: () => void) => {
        body()
      },
      register: (spec: unknown) => {
        registrations.push(spec)
        return undefined
      },
    },
  }
}

function stubFetch(status: number): void {
  ;(globalThis as Record<string, unknown>).fetch = async () => ({
    status,
    json: async () => ({}),
  })
}

// stubRoutes answers the two bootstrap probes by path: the main card probes
// /local-infer/summary, the orchestrator card probes /local-infer/orchestrator.
// A status of 0 makes that probe reject, modeling a network failure.
function stubRoutes(main: number, orchestrator: number): void {
  ;(globalThis as Record<string, unknown>).fetch = async (input: string | URL) => {
    const url = String(input)
    const status = url === '/local-infer/orchestrator' ? orchestrator : main
    if (status === 0) {
      throw new Error('the host is down')
    }
    return { status, json: async () => ({}) }
  }
}

function names(registrations: unknown[]): string[] {
  return (registrations as { name: string }[]).map((r) => r.name)
}

describe('client bootstrap source (plugin.ts)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).fetch
  })

  it('exports the lazy-CJS entry points', () => {
    expect(typeof apply).toBe('function')
    expect(inject).toEqual([])
  })

  it('is a no-op when ctx.inject is not a function', () => {
    apply({} as ApplyCtx)
    // No inject, so no fetch is scheduled and no require runs.
    expect(typeof (globalThis as Record<string, unknown>).fetch).toBe('undefined')
  })

  it('registers the card through the locale and slots seams', async () => {
    const injected: string[][] = []
    const scope = makeScope([])
    const ctx = {
      inject: (names: string[], fn: (s: Scope) => void) => {
        injected.push(names)
        fn(scope)
      },
    }
    stubFetch(404)
    apply(ctx as ApplyCtx)
    expect(injected).toEqual([
      ['locale'],
      ['slots'],
    ])
  })

  it('skips the locale effect when the scope has none', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations, false)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubFetch(200)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(names(registrations)).toEqual([
      'plugins.bundle.config',
      'settings.plugin.item',
      'plugins.row.config',
    ])
  })

  it('skips the mount when the route probe 404s', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubFetch(404)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registrations).toEqual([])
  })

  it('mounts the card and registers both slots when the route probe succeeds', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubRoutes(200, 404)
    apply(ctx as ApplyCtx)
    // The mount runs in a microtask after the probe resolves.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(names(registrations)).toEqual([
      'plugins.bundle.config',
      'settings.plugin.item',
    ])
  })

  it('registers the orchestrator card into plugins.row.config when its route exists', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubRoutes(200, 200)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The main card mounts first (its probe is issued first), then the
    // orchestrator card into its own slot; the two cards never share a cell.
    expect(names(registrations)).toEqual([
      'plugins.bundle.config',
      'settings.plugin.item',
      'plugins.row.config',
    ])
    const rowReg = (registrations as { name: string; key?: string }[]).find(
      (r) => r.name === 'plugins.row.config',
    )
    expect(rowReg?.key).toBe('dsh-plugin-local-infer#local-infer-orchestrator')
  })

  it('skips the orchestrator card when its route 404s (component disabled)', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubRoutes(200, 404)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(names(registrations)).toEqual([
      'plugins.bundle.config',
      'settings.plugin.item',
    ])
  })

  it('skips the orchestrator card when its probe hits a network failure', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubRoutes(200, 0)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(names(registrations)).toEqual([
      'plugins.bundle.config',
      'settings.plugin.item',
    ])
  })

  it('mounts the orchestrator card without the main card route (rows toggle independently)', async () => {
    const registrations: unknown[] = []
    const scope = makeScope(registrations)
    const ctx = { inject: (_n: string[], fn: (s: Scope) => void) => fn(scope) }
    stubRoutes(404, 200)
    apply(ctx as ApplyCtx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(names(registrations)).toEqual(['plugins.row.config'])
  })
})
