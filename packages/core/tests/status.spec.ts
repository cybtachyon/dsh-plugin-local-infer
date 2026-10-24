import { describe, expect, it } from 'vitest'
import { computeProviderStatuses, isGpuBusy } from '../src/index.ts'
import type { GpuUsageProbe, ProviderRef, RunningEngineRef } from '../src/index.ts'

const BUSY: GpuUsageProbe = { usedMiB: 18432, totalMiB: 24576 }
const IDLE: GpuUsageProbe = { usedMiB: 2048, totalMiB: 24576 }

describe('isGpuBusy', () => {
  it('reads the card as busy at the 75% threshold', () => {
    // 18432/24576 is exactly 0.75: the card reads as busy.
    expect(isGpuBusy(BUSY)).toBe(true)
  })

  it('reads the card as not busy below the threshold', () => {
    expect(isGpuBusy(IDLE)).toBe(false)
  })

  it('reads a missing reading or an empty total as not busy', () => {
    expect(isGpuBusy(null)).toBe(false)
    expect(isGpuBusy(undefined)).toBe(false)
    expect(isGpuBusy({ usedMiB: 4096, totalMiB: 0 })).toBe(false)
  })
})

describe('computeProviderStatuses', () => {
  const providers: ProviderRef[] = [
    { id: 'a', engine: 'ninfer', model: 'qwen3-27b' },
    { id: 'b', engine: 'ninfer', model: 'qwen3-35b' },
    { id: 'c', engine: 'hyperqwen', model: 'qwen3-27b' },
  ]

  it('reads every provider as stopped when no engine is running', () => {
    // A process probe that saw no engine means a saved config whose engine is
    // down is stopped (red), not an unattributable yellow.
    const statuses = computeProviderStatuses({ providers, running: [], gpuBusy: false })
    expect(statuses).toEqual({ a: 'stopped', b: 'stopped', c: 'stopped' })
  })

  it('reads a running engine as running and a busy card as unsure for the rest', () => {
    // A running engine using its VRAM reads as running (green), not the
    // unattributable yellow. A busy card (a foreign engine holding the VRAM)
    // reads as unsure for a provider whose engine is not running.
    const running: RunningEngineRef[] = [
      { engineId: 'ninfer', port: 18020, modelId: 'qwen3-27b' },
    ]
    const statuses = computeProviderStatuses({ providers, running, gpuBusy: true })
    expect(statuses).toEqual({ a: 'running', b: 'unsure', c: 'unsure' })
  })

  it('reads a confirmed engine-plus-model as running and the rest as unsure or stopped', () => {
    const running: RunningEngineRef[] = [
      { engineId: 'ninfer', port: 18020, modelId: 'qwen3-27b' },
    ]
    const statuses = computeProviderStatuses({ providers, running, gpuBusy: false })
    // a matches the running engine and model: running. b is the same engine
    // but a different model: unsure (the engine serves a different model).
    // c is a different engine entirely, and the card is quiet: stopped.
    expect(statuses).toEqual({ a: 'running', b: 'unsure', c: 'stopped' })
  })

  it('reads an engine the detector saw but could not tie to a model as unsure for its configs', () => {
    // The running ninfer ref carries no modelId: the detector saw the engine
    // but not which model it serves. Both ninfer configs read as unsure, and
    // the hyperqwen config (a different engine) reads as stopped.
    const running: RunningEngineRef[] = [{ engineId: 'ninfer', port: 18020 }]
    const statuses = computeProviderStatuses({ providers, running, gpuBusy: false })
    expect(statuses).toEqual({ a: 'unsure', b: 'unsure', c: 'stopped' })
  })

  it('reads a provider that names no model as unsure while its engine runs without a model', () => {
    const noModel: ProviderRef[] = [{ id: 'x', engine: 'ninfer' }]
    const running: RunningEngineRef[] = [{ engineId: 'ninfer', port: 18020, modelId: 'qwen3-27b' }]
    const statuses = computeProviderStatuses({ providers: noModel, running, gpuBusy: false })
    // The provider names no model, so it cannot be confirmed against the
    // running model: unsure, not a guess.
    expect(statuses).toEqual({ x: 'unsure' })
  })

  it('reads a provider as stopped when its engine is not among the running set', () => {
    const running: RunningEngineRef[] = [{ engineId: 'hyperqwen', port: 8080, modelId: 'qwen3-27b' }]
    const statuses = computeProviderStatuses({ providers, running, gpuBusy: false })
    expect(statuses).toEqual({ a: 'stopped', b: 'stopped', c: 'running' })
  })

  it('confirms only the provider whose port the running engine carries', () => {
    // Two configs of one engine on different ports are distinct engines: the
    // engine running on 18080 confirms the provider bound to 18080 and leaves
    // the provider bound to 18081 stopped, not unsure from a cross-port match.
    const ported: ProviderRef[] = [
      { id: 'a', engine: 'ninfer', model: 'm1', port: 18080 },
      { id: 'b', engine: 'ninfer', model: 'm2', port: 18081 },
    ]
    const running: RunningEngineRef[] = [{ engineId: 'ninfer', port: 18080, modelId: 'm1' }]
    const statuses = computeProviderStatuses({ providers: ported, running, gpuBusy: false })
    expect(statuses).toEqual({ a: 'running', b: 'stopped' })
  })

  it('keeps the engine-wide match for a provider that names no port', () => {
    // A config whose adapter declares no port (or a detector that could not
    // resolve one) keeps the pre-port behavior: any running engine of its id
    // matches.
    const unported: ProviderRef[] = [{ id: 'a', engine: 'ninfer', model: 'm1' }]
    const running: RunningEngineRef[] = [{ engineId: 'ninfer', port: 18080, modelId: 'm1' }]
    expect(computeProviderStatuses({ providers: unported, running, gpuBusy: false })).toEqual({
      a: 'running',
    })
  })
})
