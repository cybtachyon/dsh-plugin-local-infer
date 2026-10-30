import { describe, expect, it } from 'vitest'
import {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  agentDefaultOps,
  agentDefaultPointsAt,
  agentDefaultUnsetOps,
  apiKeyEnvFor,
  buildModelEntry,
  defaultApiKeyFor,
  LLM_PI_AI_NAMESPACE,
  modelRowsFrom,
  providerIdFor,
  providerRegistrationOps,
  providerRemovalOps,
  removeModelRow,
  upsertModelRow,
} from '../src/index.ts'
import type { LaunchPlan, ModelRow, SettingsOp } from '../src/index.ts'

const PLAN: LaunchPlan = {
  engineId: 'ninfer',
  kind: 'process',
  port: 18020,
  healthUrl: 'http://127.0.0.1:18020/health',
}

function plan(engineId: string, port: number): LaunchPlan {
  return {
    engineId,
    kind: 'process',
    port,
    healthUrl: `http://127.0.0.1:${port}/health`,
  }
}

describe('registrar entry derivation', () => {
  it('derives the provider id, the API-key env name, and the base URL from the plan', () => {
    // The provider id is the engine, build mode, and model slug; the display
    // name is the engine, the mode in parentheses, and the model name.
    expect(providerIdFor('ninfer', 'Qwen3.8-27B', 'local')).toBe('ninfer-local-qwen38-27b')
    expect(providerIdFor('hyperqwen', 'Qwen3.8-27B', 'local')).toBe('hyperqwen-local-qwen38-27b')
    expect(providerIdFor('ninfer', 'Qwen3.8-27B', 'docker')).toBe('ninfer-docker-qwen38-27b')
    expect(apiKeyEnvFor('ninfer')).toBe('NINFER_LOCAL_API_KEY')
    expect(apiKeyEnvFor('hyper-qwen')).toBe('HYPER_QWEN_LOCAL_API_KEY')
    // The placeholder key wraps the engine id in double braces, so a value the
    // user has not replaced reads as a placeholder, not a real key.
    expect(defaultApiKeyFor('ninfer')).toBe('{{NINFER}}_LOCAL_API_KEY')
    expect(defaultApiKeyFor('hyper-qwen')).toBe('{{HYPER_QWEN}}_LOCAL_API_KEY')
    expect(defaultApiKeyFor('llamacpp')).toBe('{{LLAMACPP}}_LOCAL_API_KEY')
    expect(defaultApiKeyFor('strata')).toBe('{{STRATA}}_LOCAL_API_KEY')

    const entry = buildModelEntry(PLAN, { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 262144 })
    expect(entry).toEqual({
      providerId: 'ninfer-local-qwen38-27b',
      modelId: 'Qwen3.8-27B',
      name: 'Ninfer (Local): Qwen3.8-27B',
      contextWindow: 262144,
      baseURL: 'http://127.0.0.1:18020/v1',
      apiKeyEnv: 'NINFER_LOCAL_API_KEY',
      apiKey: '{{NINFER}}_LOCAL_API_KEY',
    })
  })

  it('names the namespaces the profile patch layer uses', () => {
    expect(LLM_PI_AI_NAMESPACE).toBe('llm-pi-ai')
    expect(AGENT_DEFAULT_MODEL_NAMESPACE).toBe('agent-default-model')
  })
})

describe('registrar model rows', () => {
  const rows: ModelRow[] = [
    { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 262144 },
    { id: 'Qwen3.8-35B-A3B', name: 'Qwen3.8-35B-A3B', contextWindow: 262144 },
  ]

  it('replaces a row in place when the id already exists', () => {
    const next = upsertModelRow(rows, { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 131072 })
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual({ id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 131072 })
    // The untouched row keeps its extra fields, so a by-hand edit survives.
    expect(next[1]).toBe(rows[1])
  })

  it('appends a row for a new id', () => {
    const next = upsertModelRow(rows, { id: 'new', name: 'new', contextWindow: 4096 })
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({ id: 'new', name: 'new', contextWindow: 4096 })
  })

  it('removes a row by id and leaves the rest untouched', () => {
    expect(removeModelRow(rows, 'Qwen3.8-27B')).toEqual([rows[1]])
    // An id the list does not carry removes nothing.
    expect(removeModelRow(rows, 'absent')).toEqual(rows)
  })
})

describe('registrar settings ops', () => {
  it('computes the provider upsert ops over the current rows', () => {
    const entry = buildModelEntry(PLAN, { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 262144 })
    const existing: ModelRow[] = [
      { id: 'Qwen3.8-35B-A3B', name: 'Qwen3.8-35B-A3B', contextWindow: 131072 },
    ]
    const ops = providerRegistrationOps(entry, existing)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'ninfer-local-qwen38-27b', 'apiKeyEnv'], value: 'NINFER_LOCAL_API_KEY' },
      { op: 'set', path: ['providers', 'ninfer-local-qwen38-27b', 'api'], value: 'openai-completions' },
      { op: 'set', path: ['providers', 'ninfer-local-qwen38-27b', 'baseURL'], value: 'http://127.0.0.1:18020/v1' },
      {
        op: 'set',
        path: ['providers', 'ninfer-local-qwen38-27b', 'headers', 'Authorization'],
        value: 'Bearer {{NINFER}}_LOCAL_API_KEY',
      },
      {
        op: 'set',
        path: ['providers', 'ninfer-local-qwen38-27b', 'models'],
        value: [
          { id: 'Qwen3.8-35B-A3B', name: 'Qwen3.8-35B-A3B', contextWindow: 131072 },
          { id: 'Qwen3.8-27B', name: 'Ninfer (Local): Qwen3.8-27B', contextWindow: 262144 },
        ],
      },
    ])
  })

  it('computes the agent default ops and their unset', () => {
    expect(agentDefaultOps('ninfer-local', 'Qwen3.8-27B')).toEqual([
      { op: 'set', path: ['provider'], value: 'ninfer-local' },
      { op: 'set', path: ['model'], value: 'Qwen3.8-27B' },
    ])
    expect(agentDefaultUnsetOps()).toEqual([
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
  })

  it('removes the whole provider when the last model goes and keeps it otherwise', () => {
    expect(providerRemovalOps('ninfer-local', [])).toEqual([
      { op: 'unset', path: ['providers', 'ninfer-local'] },
    ])
    const remaining: ModelRow[] = [{ id: 'Qwen3.8-35B-A3B', name: 'Qwen3.8-35B-A3B', contextWindow: 131072 }]
    expect(providerRemovalOps('ninfer-local', remaining)).toEqual([
      { op: 'set', path: ['providers', 'ninfer-local', 'models'], value: remaining },
    ])
  })
})

describe('registrar section reads', () => {
  it('extracts the models list from a settings section value', () => {
    const value = {
      providers: {
        'ninfer-local': {
          api: 'openai-completions',
          models: [
            { id: 'Qwen3.8-27B', name: 'Qwen3.8-27B', contextWindow: 262144, input: ['text', 'image'] },
          ],
        },
      },
    }
    const rows = modelRowsFrom(value, 'ninfer-local')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('Qwen3.8-27B')
    // Extra fields the settings editor owns survive the read.
    expect((rows[0] as { input?: string[] }).input).toEqual(['text', 'image'])
  })

  it('reads a missing or broken section as an empty list', () => {
    expect(modelRowsFrom(undefined, 'ninfer-local')).toEqual([])
    expect(modelRowsFrom(null, 'ninfer-local')).toEqual([])
    expect(modelRowsFrom({ providers: {} }, 'ninfer-local')).toEqual([])
    // A providers field that is not an object (or a provider that is not an
    // object) reads as empty, so a hand-edit that reshapes the section never
    // throws.
    expect(modelRowsFrom({ providers: 'nope' }, 'ninfer-local')).toEqual([])
    expect(modelRowsFrom({ providers: { 'ninfer-local': 'nope' } }, 'ninfer-local')).toEqual([])
    expect(
      modelRowsFrom(
        { providers: { 'ninfer-local': { models: 'not-a-list' } } },
        'ninfer-local',
      ),
    ).toEqual([])
    // A row without a string id is skipped, so a half-written row never
    // poisons the list.
    expect(
      modelRowsFrom(
        { providers: { 'ninfer-local': { models: [{ name: 'no id' }, { id: 'ok' }] } } },
        'ninfer-local',
      ).map((row) => row.id),
    ).toEqual(['ok'])
    // A non-object entry in the models list is skipped the same way.
    expect(
      modelRowsFrom(
        { providers: { 'ninfer-local': { models: [null, 'nope', { id: 'ok' }] } } },
        'ninfer-local',
      ).map((row) => row.id),
    ).toEqual(['ok'])
  })

  it('reports the agent default section only when it names the pair', () => {
    expect(agentDefaultPointsAt({ provider: 'ninfer-local', model: 'Qwen3.8-27B' }, 'ninfer-local', 'Qwen3.8-27B')).toBe(true)
    expect(agentDefaultPointsAt({ provider: 'ninfer-local', model: 'Qwen3.8-27B' }, 'hyperqwen-local', 'Qwen3.8-27B')).toBe(false)
    expect(agentDefaultPointsAt(undefined, 'ninfer-local', 'Qwen3.8-27B')).toBe(false)
  })
})

describe('registrar ops pass through the seam', () => {
  it('keeps the core op shape assignable to the settings seam op type', () => {
    // The service declares the seam structurally with a readonly path; the
    // core ops (mutable string[]) must stay assignable, so no translation
    // layer is needed at the seam.
    type SeamOp =
      | { op: 'set'; path: readonly string[]; value: unknown }
      | { op: 'unset'; path: readonly string[] }
    const ops: SettingsOp[] = providerRegistrationOps(
      buildModelEntry(plan('ninfer', 8080), { id: 'm', name: 'm', contextWindow: 4096 }),
      [],
    )
    const seamOps: SeamOp[] = ops
    expect(seamOps).toHaveLength(5)
  })
})
