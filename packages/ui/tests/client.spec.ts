import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * dsh/client.js is the hand-written browser carrier: it has no build step and
 * no test of its own, so this suite loads it under a fake
 * window.__ModuleLoader__ and pins the contract the dsh client-module scan and
 * the card's routes rely on. The loader captures the spec instead of running
 * the factory, so the test drives the factory with a stub require and a stub
 * plugin context.
 */

// The carrier lives at the repo root, three levels above this test file.
const clientPath = new URL('../../../dsh/client.js', import.meta.url)

interface ModuleLoaderSpec {
  id: string
  factory: (require: (name: string) => unknown) => Record<string, unknown>
}

let loaded: ModuleLoaderSpec | undefined
let previousWindow: unknown

afterAll(() => {
  if (previousWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    (globalThis as { window?: unknown }).window = previousWindow
  }
})

// The card probes /local-infer/summary on mount. A 404 reads as "the route is
// absent", so the mount is skipped and require('react') never runs.
function stubFetch(status: number): void {
  globalThis.fetch = (async () => ({
    status,
    json: async () => ({ engineId: 'ninfer' }),
  })) as unknown as typeof fetch
}

// The hooks the card component calls. mountCard only constructs the component
// (it does not render it), so the stubs are never invoked at mount time; they
// exist so a render in a future test has a surface to call.
const reactStub = {
  useState: (initial: unknown) => [initial, () => undefined],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => undefined,
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => string) => getSnapshot(),
  createElement: () => null,
}

function loadPlugin(): { apply: (ctx: unknown) => void; inject: unknown } {
  const plugin = loaded!.factory((name: string) => {
    if (name === 'react') {
      return reactStub
    }
    throw new Error(`unexpected require of ${name}`)
  })
  return plugin as { apply: (ctx: unknown) => void; inject: unknown }
}

describe('dsh/client.js browser carrier', () => {
  it('loads as the lazy-CJS plugin the dsh client-module scan expects', async () => {
    previousWindow = (globalThis as { window?: unknown }).window
    globalThis.window = {
      __ModuleLoader__: {
        load: (spec: ModuleLoaderSpec) => {
          loaded = spec
        },
      },
    }
    stubFetch(404)
    await import(clientPath.href)
    expect(loaded).toBeDefined()
    expect(loaded?.id).toBe('@dsh/dsh-plugin-local-infer')
    const plugin = loadPlugin()
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.inject).toEqual([])
  })

  it('registers the card through the locale and slots seams', () => {
    const injected: string[][] = []
    const scope = {
      locale: undefined,
      effect: (disposer: () => void) => disposer(),
      slots: {
        inject: (_name: string) => {
          /* the 404 probe skips the mount, so no slot registration happens */
        },
      },
    }
    const ctx = {
      inject: (names: string[], fn: (scope: unknown) => void) => {
        injected.push(names)
        fn(scope)
      },
    }
    stubFetch(404)
    loadPlugin().apply(ctx)
    expect(injected).toEqual([
      ['locale'],
      ['slots'],
    ])
  })

  it('mounts the card and registers both slots when the route probe succeeds', async () => {
    const slotNames: string[] = []
    const scope = {
      locale: undefined,
      effect: (disposer: () => void) => disposer(),
      slots: {
        inject: (name: string) => {
          slotNames.push(name)
        },
        register: () => undefined,
      },
    }
    const ctx = {
      inject: (_names: string[], fn: (scope: unknown) => void) => {
        fn(scope)
      },
    }
    stubFetch(200)
    loadPlugin().apply(ctx)
    // The mount runs in a microtask after the probe resolves.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slotNames).toEqual(['plugins.bundle.config', 'settings.plugin.item'])
  })

  it('pins the route contract the card calls', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    for (const route of [
      '/local-infer/summary',
      '/local-infer/save',
      '/local-infer/deps',
      '/local-infer/install',
      '/local-infer/launch',
      '/local-infer/stop',
      '/local-infer/register',
      '/local-infer/unregister',
    ]) {
      expect(source).toContain(route)
    }
  })
})
