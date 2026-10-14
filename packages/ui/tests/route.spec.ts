import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  Config,
  GuidelineResult,
  HardwareProfile,
  VramBreakdown,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'
import type { LocalInferService } from '@dsh/dsh-plugin-local-infer/service'
import { buildSummary, localInferConfigPath, readConfig, writeConfig } from '../src/route.ts'

const HW: HardwareProfile = {
  os: 'linux',
  cpuThreads: 8,
  dockerAvailable: true,
  wsl2: false,
  hostRamGiB: 32,
  gpu: { name: 'RTX 3090', vramGiB: 24, sm: 86 },
}

const BREAKDOWN: VramBreakdown = {
  weights: 1,
  kv: 2,
  overhead: 3,
  workspace: 4,
  free: 100,
  reserve: 10,
  total: 20,
  usable: 30,
  largestFittingContext: 8192,
}

const FITS: VramVerdict = { status: 'fits', detail: 'fits with headroom' }

// A guideline result the banner and the inline map both render from: an
// error anchored to kvDtype, which is the plan's red-warning contract.
const FIRED: GuidelineResult[] = [
  {
    id: 'vram-exceeds-usable',
    level: 'error',
    message: 'the KV cache exceeds the usable VRAM',
    anchors: ['kvDtype'],
  },
]

function stubService(guidelines: GuidelineResult[]): LocalInferService {
  return {
    detectHardware: async () => HW,
    estimate: async () => ({ breakdown: BREAKDOWN, verdict: FITS, source: 'measured' }),
    guidelines: async () => guidelines,
    registeredVramModels: () => [],
  } as unknown as LocalInferService
}

describe('local-infer route read model', () => {
  let home: string

  beforeAll(() => {
    // readConfig and writeConfig key the config file on homedir(), so the
    // suite points HOME at a scratch dir and never touches the real one.
    home = mkdtempSync(join(tmpdir(), 'local-infer-route-'))
    process.env.HOME = home
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('prices the meter and fires the guideline warnings in one summary', async () => {
    const summary = await buildSummary(stubService(FIRED), { engine: 'ninfer', config: {} })
    expect(summary.engineId).toBe('ninfer')
    expect(summary.verdict).toEqual(FITS)
    expect(summary.meterModel.largestFittingContext).toBe(8192)
    expect(summary.warningsModel.banner.visible).toBe(true)
    expect(summary.warningsModel.banner.level).toBe('error')
    expect(summary.warningsModel.banner.count).toBe(1)
    expect(summary.warningsModel.inline['kvDtype']).toHaveLength(1)
    expect(summary.warningsModel.inline['kvDtype']?.[0]?.tone).toBe('red')
  })

  it('reads the banner as hidden when no guideline fired', async () => {
    const summary = await buildSummary(stubService([]), { engine: 'hyperqwen', config: {} })
    expect(summary.engineId).toBe('hyperqwen')
    expect(summary.warningsModel.banner.visible).toBe(false)
    expect(Object.keys(summary.warningsModel.inline)).toEqual([])
  })

  it('falls back to the first engine when the request names none', async () => {
    const summary = await buildSummary(stubService([]), undefined)
    expect(summary.engineId).toBe('ninfer')
  })

  it('round-trips the stored config through the file the CLI shares', () => {
    const config: Config = { maxContext: 65536 }
    writeConfig('ninfer', config)
    expect(localInferConfigPath()).toBe(join(home, '.dsh', 'local-infer', 'config.json'))
    expect(readConfig()).toEqual({ engine: 'ninfer', config })
  })

  it('reads a missing config file as the scaffold default', () => {
    // The round-trip above wrote the file, so clear it for this assertion.
    rmSync(localInferConfigPath())
    expect(readConfig()).toEqual({ engine: 'ninfer', config: {} })
  })
})
