import { describe, expect, it } from 'vitest'
import type { GuidelineResult } from '@dsh/dsh-plugin-local-infer/core'
import { renderWarnings, toneFor } from '../src/warnings.ts'

const over: GuidelineResult = {
  id: 'vram-exceeds-usable',
  level: 'error',
  message: 'The context exceeds the usable VRAM: the largest fitting context is 245760 tokens.',
  anchors: ['maxContext'],
}

const sm: GuidelineResult = {
  id: 'constraint:kvDtype',
  level: 'error',
  message: 'nvfp4 KV needs SM 89 or newer; this card reports SM 86. Pick rk4v4 or k8v4.',
  anchors: ['kvDtype'],
}

const host: GuidelineResult = {
  id: 'host-tiers-exceed-host-ram',
  level: 'warn',
  message: 'The host KV and state tiers pin more host RAM than this machine reports.',
  anchors: ['hostKvMib', 'hostStateSlots'],
}

const bannerOnly: GuidelineResult = {
  id: 'docker-not-installed',
  level: 'error',
  message: 'Docker is selected but not installed.',
}

const info: GuidelineResult = {
  id: 'device-profile-calibrates',
  level: 'info',
  message: 'auto will calibrate this GPU once on first boot.',
}

describe('renderWarnings', () => {
  it('paints an error result red and a warning amber', () => {
    expect(toneFor('error')).toBe('red')
    expect(toneFor('warn')).toBe('amber')
    expect(toneFor('info')).toBe('neutral')
    const model = renderWarnings([over, host, info])
    expect(model.banner.warnings.map((warning) => warning.tone)).toEqual(['red', 'amber', 'neutral'])
  })

  it('shows the banner in the worst level present, counting every fired rule', () => {
    const model = renderWarnings([host, over])
    expect(model.banner.visible).toBe(true)
    expect(model.banner.level).toBe('error')
    expect(model.banner.count).toBe(2)
    expect(model.banner.warnings.map((warning) => warning.id)).toEqual([
      'host-tiers-exceed-host-ram',
      'vram-exceeds-usable',
    ])
  })

  it('groups inline warnings by anchored parameter, in result order', () => {
    const model = renderWarnings([over, sm, host, bannerOnly, info])
    expect(Object.keys(model.inline).sort()).toEqual(['hostKvMib', 'hostStateSlots', 'kvDtype', 'maxContext'])
    expect(model.inline.maxContext?.map((warning) => warning.id)).toEqual(['vram-exceeds-usable'])
    expect(model.inline.kvDtype?.map((warning) => warning.id)).toEqual(['constraint:kvDtype'])
    expect(model.inline.hostKvMib?.map((warning) => warning.id)).toEqual(['host-tiers-exceed-host-ram'])
    // A rule with no anchors reaches the banner only, never the inline map.
    expect(model.banner.warnings.map((warning) => warning.id)).toContain('docker-not-installed')
    expect(model.inline.docker).toBeUndefined()
  })

  it('keeps a rule with several anchors on every one of them', () => {
    const model = renderWarnings([host])
    expect(model.inline.hostKvMib?.[0]).toBe(model.inline.hostStateSlots?.[0])
  })

  it('hides the banner and the inline map when nothing fired', () => {
    const model = renderWarnings([])
    expect(model.banner.visible).toBe(false)
    expect(model.banner.level).toBeNull()
    expect(model.banner.count).toBe(0)
    expect(model.banner.warnings).toEqual([])
    expect(model.inline).toEqual({})
  })
})
