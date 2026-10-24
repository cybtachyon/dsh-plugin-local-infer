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
  IconRefreshOutlineRegular: () => null,
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

  it('pins the settings-only save the setting toggles send', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The help and allow-run toggles persist the global fields through the
    // save route with settingsOnly set, so the route keeps the provider list
    // intact and a toggle never mints a duplicate entry. The main Save omits
    // the flag and keeps the upsert contract.
    expect(source).toContain('settingsOnly')
    expect(source).toContain('onAllowRun')
  })

  it('pins the refresh button contract the card re-fetches through', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The circular refresh button sits next to the "?" help button in the
    // card header. It re-fetches the summary and deps from the host, so the
    // card re-prices after the harness pauses and re-activates the plugin's
    // routes. The glyph is the primitives seed's refresh icon; a host
    // without the seed keeps the native arrow character.
    expect(source).toContain('IconRefreshOutlineRegular')
    expect(source).toContain('t.refresh')
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
    // The main Launch hands the Logs section the finished run: its handler
    // re-reads the summary, so the stored launch command line and the
    // engine's output replace the previous run in the text area. The Auto
    // Rebuild checkbox (checked by default) rides the launch body: unchecked,
    // the route skips the git sync (fetch, rebase, rebuild) and launches the
    // checkout as-is.
    expect(source).toContain('[draft, launching, editingProviderId, autoRebuild, t, fetchSummary]')
    expect(source).toContain('autoRebuildState')
    expect(source).toContain('autoRebuild: autoRebuild')
  })

  it('pins the per-entry launch state machine and its phase labels', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The per-entry Launch control is a hardened state machine: the rebuild
    // phases (prereqs, download, build, launch) advance forward, a healthy
    // result settles to running, a failed result settles to failed, and a
    // stop or a break resets to idle.
    expect(source).toContain('launchNextState')
    expect(source).toContain('LAUNCH_STEP_ORDER')
    expect(source).toContain('LAUNCH_PHASE_STATES')
    // The button reads the phase that is running, not a single "Launching...".
    expect(source).toContain('entryPrereqs')
    expect(source).toContain('entryDownloading')
    expect(source).toContain('entryBuilding')
    expect(source).toContain('entryLaunching')
    // The launch stream is NDJSON: a step event as each phase begins, then a
    // final result event the card reads through the response body stream.
    expect(source).toContain('response.body.getReader')
    expect(source).toContain('event.step')
    expect(source).toContain('event.result')
    // The health-poll deadline arms only for the launch (health-poll) step; the
    // rebuild steps (prereqs, download, build) run without a timeout.
    expect(source).toContain('LAUNCH_HEALTH_DEADLINE_MS')
    expect(source).toContain("event.step === 'launch'")
  })

  it('pins the launch record contract the restart re-link prices', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card's launch and stop bodies carry the provider entry's id, so the
    // route persists (or clears) the launch record on that entry and a DSH
    // restart re-links a surviving engine to its config.
    expect(source).toContain('providerId: provider.id')
    expect(source).toContain('body.providerId = editingProviderId')
  })

  it('pins the provider Edit to Cancel swap while a provider is being edited', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The provider the editing form is open for shows a Cancel button (which
    // collapses the form back to Edit and discards its changes); every other
    // provider shows the Edit button that opens it.
    expect(source).toContain('onCancelProvider')
    expect(source).toContain('cancelLabel')
    expect(source).toContain('editingId === provider.id')
  })

  it('pins the port number entry without a range strip and the hardware-priced slider cap', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A slider control with slider:false (the port field) renders the number
    // entry alone; the range strip's cap is the hardware-priced sliderMax when
    // the form declares one (the host-KV pool caps at half the host RAM), else
    // the static max.
    expect(source).toContain('control.slider === false')
    expect(source).toContain('control.sliderMax')
  })

  it('pins the chat template preset plus custom split and the auto-download', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The chat template is split into a preset dropdown (shipped presets plus a
    // Custom entry) and a "Custom Chat template" text field that shows while the
    // preset is Custom. The auto-download pulls an absent template through the
    // /local-infer/chat-template route, and the System dependencies box carries
    // the download command when the CLI is unavailable.
    expect(source).toContain('ChatTemplateField')
    expect(source).toContain('chatTemplatePreset')
    expect(source).toContain('customChatTemplate')
    expect(source).toContain('onDownloadTemplate')
    expect(source).toContain('chatTemplateStatus')
    expect(source).toContain('templateAbsent')
    expect(source).toContain('templateInstructions')
  })

  it('pins the Save handler clearing the editing provider so the button reverts to Edit', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A successful Save collapses the form and clears the editing provider id,
    // so the provider entry's button reverts from Cancel back to Edit, the
    // same rule the Discard handler applies.
    expect(source).toContain('editingProviderIdState[1](null)')
  })

  it('pins the Remove handler keying off the same config as Register', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The unregister request carries draft.config, the same config the
    // register step sent, so the provider and model ids the removal derives
    // are identical to the ones the registration published, and the DSH
    // settings row is actually removed.
    expect(source).toContain('engine: draft.engine, config: draft.config')
  })

  it('pins the Discard handler collapsing the form back to the entry list', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A "New provider" then "Discard" sequence must not leave the form open in
    // 'new' mode. The Discard handler collapses the form back to the provider
    // entry list, the same rule the Save handler applies.
    expect(source).toContain('providerFormModeState[1](\'collapsed\')')
  })

  it('pins the unsure banner with kill commands at the top of the card', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The "unsure" banner renders at the top of the card (before the section
    // title) when data.unsureBanner is present: the message and a read-only
    // text area with the bash kill commands for the engine processes the
    // detector saw holding VRAM.
    expect(source).toContain('data.unsureBanner')
    expect(source).toContain('unsureBanner')
    expect(source).toContain('killCommands')
  })

  it('pins the Custom Arguments table the card renders before System dependencies', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The section is a key/value table (parameter, value, the + / - controls)
    // the user fills with extra launch flags. The rows live in the draft
    // config's customArgs field, so a Save persists them and the next engine
    // launch appends them to the command line.
    expect(source).toContain('renderCustomArgsPanel')
    expect(source).toContain('onCustomArgs')
    expect(source).toContain('customArgs')
    expect(source).toContain('customArgsTitle')
    expect(source).toContain('customArgKeyHeader')
    expect(source).toContain('customArgValueHeader')
    // The first row is cleared, not removed; a lower row is removed; + adds a
    // row. The action verbs pin that behavior.
    expect(source).toContain("'clear'")
    expect(source).toContain("'remove'")
    expect(source).toContain("'add'")
  })

  it('pins the build-method-dependent platform fields in the Engine platform section', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Engine platform section shows the Build commands override in local
    // build mode and the Docker tag override in docker build mode, one at a
    // time, each seeded with the engine's own default as the placeholder. The
    // values ride the platform map (onPlatform), not the config.
    expect(source).toContain('t.buildCommands')
    expect(source).toContain('t.dockerTag')
    expect(source).toContain("buildMode === 'local'")
    expect(source).toContain("buildMode === 'docker'")
    expect(source).toContain("'buildCommands'")
    expect(source).toContain("'dockerTag'")
    expect(source).toContain('engineEntry.defaultBuildCommand')
    expect(source).toContain('engineEntry.defaultDockerTag')
  })

  it('pins the debounced re-price the field edits schedule', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A field edit updates the draft config and schedules a debounced re-price
    // of the VRAM Est. meter and the deps panel. The draft update is pure; the
    // re-price runs only after typing pauses (the 300ms timeout), so a fast
    // keystroke stream is one round trip, not one per letter. The timeout is
    // reset on every field change, and the fetch reads the latest committed
    // draft from a ref, not a stale closure.
    expect(source).toContain('scheduleReprice')
    expect(source).toContain('draftRef')
    expect(source).toContain('timerRef')
    // The field edit and the engine switch both schedule the debounced
    // re-price, and the draft update stays pure (no timer side effect inside
    // the state updater).
    expect(source).toContain('scheduleReprice()')
  })

  it('pins the draft-bound field value the free-text inputs read', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The form field value binds to the local draft, not the server render
    // model, so a typed keystroke shows in the input immediately. The server
    // model (field.value) resolves the spec default and only surfaces after
    // the debounced re-price settles. A key the user has not edited is absent
    // from the draft, so it falls back to the model. This is what keeps the
    // free-text fields (the API key, the chat template, the path pickers)
    // from lagging a keystroke behind the server round trip.
    expect(source).toContain('effectiveField')
    expect(source).toContain('draft.config[field.key]')
    expect(source).toContain('Object.assign({}, field, { value: draftValue })')
  })
})
