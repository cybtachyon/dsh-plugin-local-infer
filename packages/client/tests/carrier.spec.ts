import { afterAll, describe, expect, it } from 'vitest'

/**
 * dsh/client.js is a generated artifact (scripts/build-client.mjs bundles
 * packages/client/src into the lazy-CJS carrier), so this suite loads it under
 * a fake window.__ModuleLoader__ and pins the contract the dsh client-module
 * scan and the card's routes rely on. The loader captures the spec instead of
 * running the factory, so the test drives the factory with a stub require and a
 * stub plugin context.
 *
 * The stub require maps the two runtime externals (react, the primitives seed)
 * to fakes, so the bootstrap's require(...) calls resolve against it. This is
 * the carrier-level home for the bootstrap behavior the old hand-written
 * carrier pinned (packages/ui/tests/client.spec.ts); the source-pinning
 * assertions rejoin here as the component port (T3.x) lands.
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
  delete (globalThis as Record<string, unknown>).fetch
})

// The card probes /local-infer/summary on mount. A 404 reads as "the route is
// absent", so the mount is skipped and require('react') never runs.
function stubFetch(status: number): void {
  ;(globalThis as Record<string, unknown>).fetch = (async () => ({
    status,
    json: async () => ({ engineId: 'ninfer' }),
  })) as unknown
}

// The hooks the card component calls. mountCard only constructs the component
// (it does not render it), so the stubs are never invoked at mount time; they
// exist so a render in a future test has a surface to call.
const reactStub = {
  createElement: (..._args: unknown[]) => null,
}

// The DSH primitives seed the shell puts in the frozen platform module table.
// The card draws its menus, buttons, checkboxes, and state dots from this
// module; the stub names the members the card touches so a renamed export
// fails the mount, and a loader that throws for it exercises the native
// fallback.
const primitivesStub = {
  Menu: () => null,
  Button: () => null,
  Checkbox: () => null,
  StateDot: () => null,
}

function loadPlugin(options?: { primitives?: unknown; required?: string[] }): {
  apply: (ctx: unknown) => void
  inject: unknown
} {
  const required: string[] = options?.required ?? []
  const plugin = loaded!.factory((name: string) => {
    if (name === 'react') {
      return reactStub
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      required.push(name)
      if (options?.primitives === undefined) {
        return primitivesStub
      }
      if (options.primitives instanceof Error) {
        throw options.primitives
      }
      return options.primitives
    }
    throw new Error(`unexpected require of ${name}`)
  })
  return plugin as { apply: (ctx: unknown) => void; inject: unknown }
}

function mountScope() {
  const slotNames: string[] = []
  const scope = {
    locale: undefined,
    effect: (disposer: () => void) => {
      disposer()
    },
    slots: {
      inject: (name: string) => {
        slotNames.push(name)
      },
      register: () => undefined,
    },
  }
  return {
    slotNames,
    ctx: {
      inject: (_names: string[], fn: (scope: unknown) => void) => {
        fn(scope)
      },
    },
  }
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
    expect(loaded?.id).toBe('dsh-plugin-local-infer')
    const plugin = loadPlugin()
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.inject).toEqual([])
  })

  it('registers the card through the locale and slots seams', () => {
    const injected: string[][] = []
    const scope = {
      locale: undefined,
      effect: (disposer: () => void) => {
        disposer()
      },
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

  it('is a no-op when ctx.inject is not a function', () => {
    const required: string[] = []
    loadPlugin({ required }).apply({})
    expect(required).toEqual([])
  })

  it('skips the mount when the route probe 404s', async () => {
    const { slotNames } = mountScope()
    stubFetch(404)
    loadPlugin().apply(mountScope().ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slotNames).toEqual([])
  })

  it('mounts the card and registers both slots when the route probe succeeds', async () => {
    const { slotNames, ctx } = mountScope()
    stubFetch(200)
    loadPlugin().apply(ctx)
    // The mount runs in a microtask after the probe resolves.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slotNames).toEqual(['plugins.bundle.config', 'settings.plugin.item'])
  })

  it('requires the DSH primitives seed so the card draws the host controls', async () => {
    const required: string[] = []
    const { ctx } = mountScope()
    stubFetch(200)
    loadPlugin({ required }).apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(required).toEqual(['@deepseek-ai/dsh-client-ui-primitives'])
  })

  it('keeps the card mounted when the primitives seed is absent', async () => {
    const { slotNames, ctx } = mountScope()
    stubFetch(200)
    loadPlugin({ primitives: new Error('seed absent') }).apply(ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slotNames).toEqual(['plugins.bundle.config', 'settings.plugin.item'])
  })
})
