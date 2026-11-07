/**
 * The register and unregister route helpers (model-row resolution, provider
 * identity, settings ops) and resolveContextWindow. (Split from route.spec.ts
 * by describe, TASK-012.)
 * @module dsh-plugin-local-infer/ui/tests/
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EngineAdapter, LaunchPlan, ModelRow, VramModel } from 'dsh-plugin-local-infer/core'
import { providerIdFor } from 'dsh-plugin-local-infer/core'
import type { RegisterModelOptions } from 'dsh-plugin-local-infer/service'
import { registerFor, resolveContextWindow, unregisterFor } from '../src/ops/model.ts'
import { RouteError } from '../src/route.ts'
import { fakeAdapter, pointHomeAt, stubService } from './fixtures.ts'

describe('register and unregister route helpers', () => {
  let home: string

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'local-infer-register-'))
    pointHomeAt(home)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('resolves the model row through the adapter seam and passes the options through', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        seen = args
      },
    })
    const result = await registerFor(service, {
      engine: 'ninfer',
      config: { maxContext: 32768 },
      agentDefault: true,
    })
    expect(result.ok).toBe(true)
    // The vision flag is unset, so the model row publishes the text-only
    // input types.
    expect(seen?.model).toEqual({
      id: 'Qwen3.8-27B',
      name: 'Qwen3.8-27B',
      contextWindow: 32768,
      input: ['text'],
    })
    expect(seen?.options).toEqual({ agentDefault: true })
    expect(seen?.plan.engineId).toBe('ninfer')
  })

  it('publishes the Image input type when the vision flag is set', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'ninfer', config: { vision: true } })
    expect(seen?.model?.input).toEqual(['text', 'image'])
  })

  it('falls back to the plan model id when the adapter declares no modelRef', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer')],
      onRegister: (args) => {
        seen = args
      },
    })
    // The fake adapter renders a plan without a modelId and declares no
    // modelRef, so the engine id is the published model id.
    await registerFor(service, { engine: 'ninfer', config: {} })
    expect(seen?.model?.id).toBe('ninfer')
    expect(seen?.model?.name).toBe('ninfer')
    expect(seen?.options).toBeUndefined()
  })

  it('registers the model the adapter discovers live, ahead of its modelRef', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    // Stands in for Strata: a placeholder modelRef, a live discovery of the
    // model the running engine auto-selected, and declared modalities (its
    // vision enum defaults to on).
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => ({
        id: 'qwen3.8-flash-next-iq3_s',
        name: 'qwen3.8-flash-next-iq3_s',
      }),
      modelInput: () => ['text', 'image'],
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    // The discovered id wins over the placeholder modelRef, and the declared
    // modalities win over the boolean vision flag (unset here, so the flag
    // path would have published text-only).
    expect(seen?.model).toEqual({
      id: 'qwen3.8-flash-next-iq3_s',
      name: 'qwen3.8-flash-next-iq3_s',
      contextWindow: 32768,
      input: ['text', 'image'],
    })
  })

  it('falls back to the adapter modelRef when live discovery finds nothing', async () => {
    let seen: { plan: LaunchPlan; model: ModelRow; options?: RegisterModelOptions } | undefined
    // A down engine discovers nothing, so the register step publishes the
    // modelRef row and the card stays consistent with the summary flag.
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => undefined,
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        seen = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    expect(seen?.model?.id).toBe('strata')
    expect(seen?.model?.name).toBe('Strata')
  })

  it('removes the exact discovered entry the register step wrote', async () => {
    let registered: { providerId: string; modelId: string } | undefined
    let removed: { providerId: string; modelId: string } | undefined
    const strataLike = {
      ...fakeAdapter('strata', { id: 'strata', name: 'Strata' }),
      discoverModel: async () => ({
        id: 'qwen3.8-flash-next-iq3_s',
        name: 'qwen3.8-flash-next-iq3_s',
      }),
    } as unknown as EngineAdapter
    const service = stubService([], {
      engines: [strataLike],
      onRegister: (args) => {
        registered = {
          providerId: providerIdFor(args.plan.engineId, args.model.id, 'local'),
          modelId: args.model.id,
        }
      },
      onRemove: (args) => {
        removed = args
      },
    })
    await registerFor(service, { engine: 'strata', config: { port: 8090 } })
    const result = await unregisterFor(service, { engine: 'strata', config: { port: 8090 } })
    expect(result).toEqual({ removed: true })
    // Discovery resolves the same served id in both steps, so the removal
    // targets the discovered entry, not the placeholder the modelRef names.
    expect(removed).toEqual(registered)
    expect(removed?.modelId).toBe('qwen3.8-flash-next-iq3_s')
  })

  it('unregisters the provider and model the register step resolved', async () => {
    let seen: { providerId: string; modelId: string } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRemove: (args) => {
        seen = args
      },
    })
    const result = await unregisterFor(service, { engine: 'ninfer', config: {} })
    expect(result).toEqual({ removed: true })
    expect(seen).toEqual({ providerId: 'ninfer-local-qwen38-27b', modelId: 'Qwen3.8-27B' })
  })

  it('removes the exact provider and model the register step wrote, across the full flow', async () => {
    let registered: { providerId: string; modelId: string } | undefined
    let removed: { providerId: string; modelId: string } | undefined
    const service = stubService([], {
      engines: [fakeAdapter('ninfer', { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B' })],
      onRegister: (args) => {
        // The register step writes the row through buildModelEntry, so the
        // provider id derives from the plan engine id and the row model id.
        registered = {
          providerId: providerIdFor(args.plan.engineId, args.model.id, 'local'),
          modelId: args.model.id,
        }
      },
      onRemove: (args) => {
        removed = args
      },
    })
    const config = { model: 'qwen3-27b', maxContext: 32768 }
    await registerFor(service, { engine: 'ninfer', config })
    const result = await unregisterFor(service, { engine: 'ninfer', config })
    expect(result).toEqual({ removed: true })
    // The unregister step must target the exact entry the register step wrote,
    // so the DSH settings row is removed, not left behind.
    expect(removed).toEqual(registered)
  })

  it('refuses to register an engine no adapter serves with a 404', async () => {
    const service = stubService([], { engines: [] })
    await expect(registerFor(service, { engine: 'strata' })).rejects.toThrow(
      expect.objectContaining<RouteError>({ status: 404 }),
    )
  })
})

describe('resolveContextWindow', () => {
  const MODELS: VramModel[] = [
    {
      id: 'qwen3-27b',
      source: 'measured',
      weightsBytes: 1,
      workspaceBytes: 1,
      nativeMaxContext: 262144,
      seqFixedBytes: 1,
      seqPerToken: 1,
      kvBytesPerToken: { int8: 1 },
    },
  ]

  it('honors a configured maxContext', () => {
    expect(resolveContextWindow({ maxContext: 131072 }, MODELS)).toBe(131072)
    // A non-positive or non-number value falls through to the model ceiling.
    expect(resolveContextWindow({ maxContext: 0 }, MODELS)).toBe(262144)
    expect(resolveContextWindow({ maxContext: '131072' }, MODELS)).toBe(262144)
  })

  it('reads the named model ceiling when the config names a model', () => {
    expect(resolveContextWindow({ model: 'qwen3-27b' }, MODELS)).toBe(262144)
    // A model no provider registered reads the spec default.
    expect(resolveContextWindow({ model: 'qwen3-99b' }, MODELS)).toBe(32768)
  })

  it('reads the single registered model ceiling when the config names none', () => {
    expect(resolveContextWindow({}, MODELS)).toBe(262144)
  })

  it('reads the spec default when no model resolves', () => {
    expect(resolveContextWindow({ model: 'qwen3-99b' }, [])).toBe(32768)
    expect(resolveContextWindow({}, [])).toBe(32768)
  })
})
