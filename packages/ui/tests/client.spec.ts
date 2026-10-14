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
  IconChevronDownOutlineRegular: () => null,
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
    expect(loaded?.id).toBe('@dsh/dsh-plugin-local-infer')
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

  it('pins the help toggle contract the card persists', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The circular "?" button flips the local state and persists the
    // preference through the save route, so the descriptions-visible
    // default survives a reload.
    expect(source).toContain('showHelp')
    expect(source).toContain('onToggleHelp')
    expect(source).toContain('renderHelpRow')
    expect(source).toContain('HELP_BUTTON_STYLE')
  })

  it('pins the provider list contract the card renders', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card lists the saved providers as collapsed cards, each with a
    // status dot and Edit/Delete controls, and talks to the provider-delete
    // route to remove one.
    expect(source).toContain('/local-infer/provider-delete')
    expect(source).toContain('renderProviderList')
    expect(source).toContain('onEditProvider')
    expect(source).toContain('onDeleteProvider')
    expect(source).toContain('editingProviderId')
  })

  it('pins the collapsible provider form and the New provider control', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Engine/Model form collapses by default while entries exist, and the
    // "New provider" control sits after the form: a button while a new
    // provider can be started, plain text while in new mode or with no
    // entries. Edit caches the current draft so a later New click restores it.
    expect(source).toContain('renderNewProviderControl')
    expect(source).toContain('providerFormMode')
    expect(source).toContain('effectiveProviderFormMode')
    expect(source).toContain('cachedDraft')
    expect(source).toContain("effectiveProviderFormMode !== 'collapsed'")
  })

  it('pins the register gate the card enforces while unsaved', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Register button stays disabled while the config is unsaved (dirty),
    // and the help line explains the gate.
    expect(source).toContain('registerNeedsSave')
    expect(source).toContain('dirty && help')
    expect(source).toContain('registering || dirty')
  })

  it('pins the Logs section and the per-entry Launch control', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card shows the last run's logs in a fixed-height text area plus a
    // log-location field, and each provider entry carries its own Launch
    // control: a Throbber while launching, Stop when healthy, a red Logs that
    // opens the entry for editing when the launch times out.
    expect(source).toContain('lastLogs')
    expect(source).toContain('logPath')
    expect(source).toContain('renderEntryLaunchButton')
    expect(source).toContain('renderThrobber')
    expect(source).toContain('onLaunchEntry')
    expect(source).toContain('onStopEntry')
    expect(source).toContain('entryLaunchState')
  })
})
