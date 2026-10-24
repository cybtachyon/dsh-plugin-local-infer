import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from 'dsh-plugin-local-infer/service'
import { BUILTIN_GUIDELINES, HOST_STATE_IMAGE_BYTES } from '../src/guidelines.ts'
import type { Guideline, HardwareProfile } from 'dsh-plugin-local-infer/core'

const baseHw: HardwareProfile = {
  dockerAvailable: true,
  wsl2: false,
  os: 'linux',
  cpuThreads: 8,
  hostRamGiB: 32,
}

function rule(id: string): Guideline {
  const guideline = BUILTIN_GUIDELINES.find((candidate) => candidate.id === id)
  expect(guideline).toBeDefined()
  return guideline as Guideline
}

describe('built-in guideline data', () => {
  it('carries the four built-in rules with unique ids and sane levels', () => {
    expect(BUILTIN_GUIDELINES.map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
      'infernix-dflash2-needs-draft-model',
    ])
    expect(new Set(BUILTIN_GUIDELINES.map((guideline) => guideline.id)).size).toBe(4)
    expect(rule('docker-not-installed').level).toBe('error')
    expect(rule('host-tiers-exceed-host-ram').level).toBe('warn')
    expect(rule('wsl2-dflash2-needs-pin-memory').level).toBe('error')
    expect(rule('infernix-dflash2-needs-draft-model').level).toBe('error')
  })

  it('fires docker-not-installed on a docker build mode or the docker-only engine', () => {
    const noDocker = { ...baseHw, dockerAvailable: false }
    expect(rule('docker-not-installed').when({ buildMode: 'docker' }, noDocker)).toBe(true)
    expect(rule('docker-not-installed').when({ engine: 'hyperqwen' }, noDocker)).toBe(true)
    expect(rule('docker-not-installed').when({ buildMode: 'docker' }, baseHw)).toBe(false)
    expect(rule('docker-not-installed').when({ engine: 'ninfer', buildMode: 'local' }, noDocker)).toBe(false)
  })

  it('fires host-tiers-exceed-host-ram when the pinned sum passes the host RAM', () => {
    // 30 GiB of host KV on a 32 GiB host fits; 40 GiB does not.
    expect(rule('host-tiers-exceed-host-ram').when({ hostKvMib: 30 * 1024 }, baseHw)).toBe(false)
    expect(rule('host-tiers-exceed-host-ram').when({ hostKvMib: 40 * 1024 }, baseHw)).toBe(true)
    // Eight state slots cost 8 * 195,897,344 B ~= 1.5 GiB, well under 32 GiB.
    expect(rule('host-tiers-exceed-host-ram').when({ hostStateSlots: 8 }, baseHw)).toBe(false)
    // The sum, not either flag alone, is what pins RAM.
    const smallHost = { ...baseHw, hostRamGiB: 2 }
    expect(
      rule('host-tiers-exceed-host-ram').when({ hostKvMib: 1024, hostStateSlots: 8 }, smallHost),
    ).toBe(true)
    // Unset tiers and an unknown host RAM stay silent.
    expect(rule('host-tiers-exceed-host-ram').when({}, baseHw)).toBe(false)
    expect(
      rule('host-tiers-exceed-host-ram').when(
        { hostKvMib: 40 * 1024 },
        { ...baseHw, hostRamGiB: undefined },
      ),
    ).toBe(false)
  })

  it('prices a state slot at the measured StateImage size', () => {
    expect(HOST_STATE_IMAGE_BYTES).toBe(195_897_344)
    const tinyHost: HardwareProfile = {
      ...baseHw,
      hostRamGiB: HOST_STATE_IMAGE_BYTES / (1024 * 1024 * 1024), // exactly one slot
    }
    expect(rule('host-tiers-exceed-host-ram').when({ hostStateSlots: 1 }, tinyHost)).toBe(false)
    expect(rule('host-tiers-exceed-host-ram').when({ hostStateSlots: 2 }, tinyHost)).toBe(true)
  })

  it('fires wsl2-dflash2-needs-pin-memory only on WSL2 without the flag', () => {
    const wsl2 = { ...baseHw, wsl2: true }
    expect(rule('wsl2-dflash2-needs-pin-memory').when({ spec: 'dflash2' }, wsl2)).toBe(true)
    expect(rule('wsl2-dflash2-needs-pin-memory').when({ spec: 'dflash2', pinMemory: true }, wsl2)).toBe(false)
    expect(rule('wsl2-dflash2-needs-pin-memory').when({ spec: 'dflash2' }, baseHw)).toBe(false)
    expect(rule('wsl2-dflash2-needs-pin-memory').when({ spec: 'mtp' }, wsl2)).toBe(false)
  })

  it('fires infernix-dflash2-needs-draft-model only on an Infernix dflash2 with no drafter path', () => {
    const rule = BUILTIN_GUIDELINES.find((candidate) => candidate.id === 'infernix-dflash2-needs-draft-model')!
    // An Infernix config (it carries the draftModelPreset key) that selects
    // dflash2 but names no drafter path fires the rule.
    expect(
      rule.when({ spec: 'dflash2', draftModelPreset: 'custom' }, baseHw),
    ).toBe(true)
    // A selected preset resolves a drafter path, so the rule stays silent.
    expect(
      rule.when(
        {
          spec: 'dflash2',
          draftModelPreset: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
          modelDirectory: '/models',
        },
        baseHw,
      ),
    ).toBe(false)
    // A Custom drafter path resolves a drafter path, so the rule stays silent.
    expect(
      rule.when(
        { spec: 'dflash2', draftModelPreset: 'custom', draftModel: '/models/custom.infernix' },
        baseHw,
      ),
    ).toBe(false)
    // A NInfer dflash2 (no draftModelPreset key) never fires the rule, because
    // it rides the model's own companion weights.
    expect(rule.when({ spec: 'dflash2' }, baseHw)).toBe(false)
    // A non-dflash2 backend never fires the rule.
    expect(
      rule.when({ spec: 'mtp', draftModelPreset: 'custom' }, baseHw),
    ).toBe(false)
  })
})

describe('built-in guideline registration', () => {
  it('registers every built-in rule with the service seam', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    const { apply } = await import('../src/index.ts')
    apply(ctx)
    expect(ctx.localInfer.registeredGuidelines().map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
      'infernix-dflash2-needs-draft-model',
    ])
  })
})
