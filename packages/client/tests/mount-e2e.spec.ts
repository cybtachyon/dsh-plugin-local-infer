// @vitest-environment jsdom
import * as reactModule from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from 'dsh-plugin-local-infer/client'
import type {
  DepsModel,
  FormFieldModel,
  LocalInferSummary,
  ProviderSummaryEntry,
} from 'dsh-plugin-local-infer/ui'
import { TEXT } from '../src/text.ts'

const t = TEXT.en

// react-dom's act() reads this flag to know a test environment is active.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The mount E2E suite: the full browser mount path under real React. The DSH
 * host seams are mocked (the cordis ctx injects, the slots service, the
 * route probe), the card is captured from the plugins.bundle.config slot the
 * bootstrap registers, and jsdom provides the document the registered
 * component renders into.
 *
 * The other suites drive the element tree with a stub hook dispatcher, which
 * never enforces React's hook-order invariants. This suite renders through
 * react-dom, so a render that changes the number of hooks a component calls
 * (invariant 308 "Rendered more hooks", 310 "Rendered fewer hooks") throws
 * the way the shell's frozen React throws in the GUI.
 */

// The deps route answer: a satisfied plan with nothing to install.
const DEPS: DepsModel = {
  engineId: 'ninfer',
  buildMode: 'local',
  packageManager: 'apt',
  deps: [],
  allSatisfied: true,
  installString: '',
  runAllowed: true,
}

function field(
  key: string,
  label: string,
  control: FormFieldModel['control'],
  value: unknown,
): FormFieldModel {
  return {
    key,
    label,
    description: label,
    group: 'General',
    control,
    value,
    disabled: false,
    disabledReason: null,
  }
}

// FORM_A carries the two slider fields and the combo the buggy card counted
// as its own hooks (two per slider, one for the combo).
const FORM_A: LocalInferSummary['formModel'] = {
  sections: [
    {
      group: 'General',
      fields: [
        field('num', 'Num', { kind: 'slider', min: 0, max: 10, step: 1, unit: 'GB' }, 5),
        field('port', 'Port', { kind: 'slider', min: 1, max: 65535, slider: false }, 8080),
        // The combo's preset rows: no 'custom' value, the control appends its
        // own synthetic Custom entry (a duplicate key would warn).
        field(
          'template',
          'Template',
          {
            kind: 'combo',
            options: [
              { value: 'preset1', label: 'Preset 1' },
              { value: 'preset2', label: 'Preset 2' },
            ],
          },
          'preset1',
        ),
      ],
    },
  ],
}

// FORM_B has no slider and no combo field, so a re-price that swaps it in
// shrinks the buggy card's hook count (the invariant 310 direction).
const FORM_B: LocalInferSummary['formModel'] = {
  sections: [
    {
      group: 'General',
      fields: [
        field('flag', 'Flag', { kind: 'checkbox' }, true),
        field('path', 'Path', { kind: 'text', placeholder: 'type a path' }, '/tmp'),
      ],
    },
  ],
}

function makeSummary(patch: Partial<LocalInferSummary>): LocalInferSummary {
  return {
    engines: [{ id: 'ninfer', label: 'NInfer', supports: { docker: true, local: true } }],
    models: [],
    hardware: { os: 'linux', arch: 'x64', gpu: null, cpuCores: 8, ramGiB: 16 },
    engineId: 'ninfer',
    formModel: { sections: [] },
    meterModel: {
      segments: [],
      cardBytes: 0,
      verdict: null,
      largestFittingContext: null,
      source: 'not-measured',
      reserveSource: 'default',
      unknownEngines: null,
    },
    verdict: null,
    warningsModel: {
      banner: { visible: false, level: null, count: 0, warnings: [] },
      inline: {},
    },
    config: {},
    platformConfigs: {},
    defaults: { config: {}, provenance: [] },
    modelDirectory: '/models',
    modelDefaults: [],
    modelStatus: null,
    chatTemplateStatus: null,
    modelFiles: [],
    showHelp: false,
    providers: [],
    logPath: '',
    lastLogs: '',
    unsureBanner: null,
    registered: false,
    ...patch,
  } as unknown as LocalInferSummary
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// installRoutes stubs the global fetch with the two route answers the card
// reads: the query-less summary read (the route probe and the mount load)
// answers the initial summary, and a query-carrying read (a re-price) answers
// the swapped-in summary. The deps route always answers the satisfied plan.
function installRoutes(initial: LocalInferSummary, reprice: LocalInferSummary): void {
  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    const path = url.split('?')[0]
    if (path === '/local-infer/summary') {
      return json(url.includes('?') ? reprice : initial)
    }
    if (path === '/local-infer/deps') {
      return json(DEPS)
    }
    return json({ error: 'no such route' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
}

// mockHost builds the DSH host seams the bootstrap drives: the cordis ctx
// with its scoped injects, the locale service, and the slots service whose
// inject bodies run immediately so the registrations are captured.
function mockHost() {
  const registrations: Array<{
    name: string
    key?: string
    id?: string
    order?: number
    component: unknown
  }> = []
  const scope = {
    locale: {
      getSnapshot: () => ({ active: 'en' }),
      subscribe: () => () => {},
    },
    effect: (disposer: () => void) => {
      disposer()
    },
    slots: {
      inject: (_name: string, body: () => void) => {
        body()
      },
      register: (
        spec: { name: string; key?: string; id?: string; order?: number },
        component: unknown,
      ) => {
        registrations.push({ ...spec, component })
        return {}
      },
    },
  }
  const ctx = {
    inject: (_names: string[], fn: (s: unknown) => void) => {
      fn(scope)
    },
  }
  return { ctx, registrations }
}

// flush settles the pending microtasks (the route probe, the fetch acks) a
// number of macrotask turns.
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// mountAndCapture runs the bootstrap against the mocked host and returns the
// card component the plugins.bundle.config slot registration carries. The
// flush is a parameter because the fake-timer test cannot use the real
// setTimeout the default one waits on.
async function mountAndCapture(flushTurns: () => Promise<void>): Promise<() => unknown> {
  const { ctx, registrations } = mockHost()
  apply(ctx as Parameters<typeof apply>[0])
  await flushTurns()
  const reg = registrations.find((entry) => entry.name === 'plugins.bundle.config')
  expect(reg?.component).toBeTypeOf('function')
  return reg!.component as () => unknown
}

// renderCard mounts the captured card into a fresh jsdom document through
// react-dom, the same way the shell's slot host renders it. The mount
// effect's fetches settle inside the act, so their acks never update the
// root outside an act scope.
async function renderCard(flushTurns: () => Promise<void>): Promise<{
  container: HTMLDivElement
  root: Root
}> {
  const Component = await mountAndCapture(flushTurns)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(reactModule.createElement(Component))
    await flushTurns()
  })
  return { container, root }
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the DSH mount E2E (the card under real React)', () => {
  it('opens a saved provider entry for editing and survives the re-price swapping in a smaller form model', async () => {
    // The test model entry: a saved provider the card lists with its Edit
    // control.
    const provider: ProviderSummaryEntry = {
      id: 'p1',
      engine: 'ninfer',
      model: 'a-model',
      status: 'stopped',
      config: { num: 5, port: 8080 },
      platform: { engineDirectory: '/eng' },
    }
    const initial = makeSummary({
      providers: [provider],
      formModel: FORM_A,
      config: { num: 5, port: 8080 },
    })
    const reprice = makeSummary({
      providers: [provider],
      formModel: FORM_B,
      config: { num: 5, port: 8080 },
    })
    installRoutes(initial, reprice)
    const { container, root } = await renderCard(() => flush())
    // The saved entry is listed with its Edit control.
    const edit = buttonByText(container, t.edit)
    expect(edit).toBeDefined()
    // The Edit click loads the entry into the form (the form opens, the hook
    // count grows) and re-prices; the re-price ack swaps in the smaller form
    // model (the hook count drops). Both renders broke the buggy card's
    // hook-order invariants (308 on the open, 310 on the swap), so a
    // regression throws here.
    await act(async () => {
      edit?.click()
    })
    await act(async () => {
      await flush()
    })
    // The form is open in editing mode: the entry's control reads as Cancel.
    expect(buttonByText(container, t.cancel)).toBeDefined()
    // The swapped-in form model's fields are drawn, and the smaller model
    // left no number entry behind.
    expect(container.querySelector('input[type="text"]')).not.toBeNull()
    expect(container.querySelector('input[type="number"]')).toBeNull()
    // React 18 processes the unmount through a flushSync whose final
    // snapshot check schedules a follow-up update, so the unmount rides an
    // act scope or it warns.
    await act(async () => {
      root.unmount()
    })
  })

  it('survives a debounced re-price that shrinks the form model in new-provider mode', async () => {
    vi.useFakeTimers()
    // No saved entries: the form is forced into new-provider mode, open with
    // FORM_A's fields. The re-price answers with the smaller FORM_B, so the
    // re-render drops the buggy card's hook count (310: "Rendered fewer
    // hooks than expected", the exact invariant the GUI reported; the buggy
    // card throws the 308 twin on the earlier form-open render, which masks
    // it, so this test pins the shrink direction through its final state).
    const initial = makeSummary({ providers: [], formModel: FORM_A })
    const reprice = makeSummary({ providers: [], formModel: FORM_B })
    installRoutes(initial, reprice)
    const fakeFlush = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(0)
    }
    const { container, root } = await renderCard(fakeFlush)
    // The open new-provider form draws FORM_A's two number entries.
    expect(container.querySelectorAll('input[type="number"]').length).toBe(2)
    // A field edit (the combo select) schedules the 300 ms debounced re-price.
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    await act(async () => {
      select!.value = 'custom'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // The debounce fires, the re-price lands the smaller form model, and the
    // re-render drops the buggy card's hook count.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(container.querySelectorAll('input[type="number"]').length).toBe(0)
    expect(container.querySelector('input[type="text"]')).not.toBeNull()
    await act(async () => {
      root.unmount()
    })
  })
})

// The orchestrator model both orchestrator routes answer.
const ORCHESTRATOR_MODEL = {
  prompt: 'the effective prompt',
  defaultPrompt: 'the shipped default prompt',
  saved: false,
}

// installOrchestratorRoutes stubs the fetch the orchestrator card drives:
// the GET answers the model, the summary probe 404s (only the orchestrator
// component is enabled in this scenario), and the save route answers through
// the test's own handler (a deferred by default).
function installOrchestratorRoutes(
  save: (body: Record<string, unknown>) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const path = url.split('?')[0]
      if (path === '/local-infer/orchestrator' && init?.method !== 'POST') {
        return json(ORCHESTRATOR_MODEL)
      }
      if (path === '/local-infer/orchestrator/save') {
        return save(JSON.parse(String(init?.body)) as Record<string, unknown>)
      }
      return json({ error: 'no such route' }, 404)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// mountAndRenderOrchestrator runs the bootstrap against the mocked host and
// mounts the component the plugins.row.config registration carries, the
// same way the shell's slot host renders the row's configuration page.
async function mountAndRenderOrchestrator(): Promise<{
  container: HTMLDivElement
  root: Root
}> {
  const { ctx, registrations } = mockHost()
  apply(ctx as Parameters<typeof apply>[0])
  await flush()
  const reg = registrations.find((entry) => entry.name === 'plugins.row.config')
  expect(reg?.component).toBeTypeOf('function')
  expect(reg?.key).toBe('dsh-plugin-local-infer#local-infer-orchestrator')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(reactModule.createElement(reg!.component as () => unknown))
    await flush()
  })
  return { container, root }
}

describe('the DSH mount E2E (the Orchestrator card under real React)', () => {
  it('renders the prompt field, prefilled, and posts the edited prompt on Save', async () => {
    const fetchMock = installOrchestratorRoutes(async (body) =>
      json({ ...ORCHESTRATOR_MODEL, prompt: String(body.prompt), saved: true }),
    )
    const { container, root } = await mountAndRenderOrchestrator()
    // The card title and the field label render.
    expect(container.textContent).toContain(TEXT.en.orchestratorSection)
    expect(container.textContent).toContain(TEXT.en.orchestratorPrompt)
    // The textarea is prefilled with the GET answer's prompt, and the shipped
    // default shows as the placeholder.
    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect((textarea as HTMLTextAreaElement).value).toBe('the effective prompt')
    expect((textarea as HTMLTextAreaElement).placeholder).toBe(ORCHESTRATOR_MODEL.defaultPrompt)
    // Edit and save. The native setter bypasses React's value tracker, so
    // the input event reads as a real user edit.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, 'edited prompt')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = buttonByText(container, TEXT.en.save)
    expect(save).toBeDefined()
    await act(async () => {
      save!.click()
      await flush()
    })
    const saveCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/local-infer/orchestrator/save',
    )
    expect(saveCall).toBeDefined()
    expect(JSON.parse(String((saveCall![1] as RequestInit).body))).toEqual({
      prompt: 'edited prompt',
    })
    // The saved note confirms; the field keeps the saved text.
    expect(container.textContent).toContain(TEXT.en.saved)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'edited prompt',
    )
    await act(async () => {
      root.unmount()
    })
  })

  it('disables the field and Save while a save is in flight and shows the route error', async () => {
    let settleSave: (response: Response) => void = () => {}
    installOrchestratorRoutes(
      () =>
        new Promise<Response>((resolve) => {
          settleSave = resolve
        }),
    )
    const { container, root } = await mountAndRenderOrchestrator()
    const save = buttonByText(container, TEXT.en.save)
    expect(save).toBeDefined()
    // The click leaves the save in flight: the control reads busy (the
    // saving label, disabled) and the field is locked until the ack lands.
    await act(async () => {
      save!.click()
    })
    expect(buttonByText(container, TEXT.en.save)).toBeUndefined()
    const busy = buttonByText(container, TEXT.en.saving)
    expect(busy).toBeDefined()
    expect(busy!.disabled).toBe(true)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true)
    // The route rejects with its own message; the card shows it and re-arms.
    await act(async () => {
      settleSave(json({ error: 'prompt must be a string' }, 400))
      await flush()
    })
    expect(container.textContent).toContain('prompt must be a string')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false)
    await act(async () => {
      root.unmount()
    })
  })

  it('shows the load error when the orchestrator route fails after the probe', async () => {
    let orchestratorGets = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = String(input)
        if (url === '/local-infer/orchestrator') {
          // The probe (the first GET) answers 200; the model load then breaks.
          orchestratorGets += 1
          return orchestratorGets === 1
            ? json(ORCHESTRATOR_MODEL)
            : json({ error: 'prompt store unreadable' }, 500)
        }
        return json({ error: 'no such route' }, 404)
      }),
    )
    const { container, root } = await mountAndRenderOrchestrator()
    expect(container.textContent).toContain('prompt store unreadable')
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => {
      root.unmount()
    })
  })
})
