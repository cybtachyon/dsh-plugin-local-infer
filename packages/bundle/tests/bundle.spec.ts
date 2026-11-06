import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from 'dsh-plugin-local-infer/service'
import localInferProviders from 'dsh-plugin-local-infer/providers'
import localInferTool from 'dsh-plugin-local-infer/tool'
import localInferUi from 'dsh-plugin-local-infer/ui'
import localInferOrchestrator from 'dsh-plugin-local-infer/orchestrator'

/** One `insert` row of a cordis.patch.yml file. */
interface PatchRow {
  id: string
  name: string
  disabled?: boolean
}

/**
 * patchRows returns the insert rows of one patch file copy. Each copy is a
 * single layer whose `insert` list mounts the bundle's rows; the two copies
 * differ only in their header comments.
 */
function patchRows(patchFile: string): PatchRow[] {
  const [layer] = parseYaml(readFileSync(patchFile, 'utf8')) as [{ insert: PatchRow[] }]
  return layer.insert
}

/** The orchestrator row: the fifth component row, shipped disabled. */
const orchestratorRow: PatchRow = {
  id: 'local-infer-orchestrator',
  name: 'dsh-plugin-local-infer/orchestrator',
  disabled: true,
}

/**
 * The Phase 0 exit criterion, five rows since TASK-006: the empty plugin
 * bundle loads into a DSH profile (a fresh Cordis Context) with no errors.
 * Mounting all five rows of cordis.patch.yml together proves the layer is
 * coherent and the seam is available to every consumer.
 */
describe('local-infer bundle', () => {
  it('loads all five plugin rows into one Context without error', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferProviders)
    await ctx.plugin(localInferTool)
    await ctx.plugin(localInferUi)
    await ctx.plugin(localInferOrchestrator)
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
    // The providers row registers all six engine adapters: the measured
    // NInfer and Hyper-Qwen, the specified llama.cpp, the local-only
    // Infernix, the Strata, and the Blackwell-only Basalt.
    expect(ctx.localInfer.registeredEngines().map((engine) => engine.id)).toEqual([
      'ninfer',
      'hyperqwen',
      'llamacpp',
      'infernix',
      'strata',
      'basalt',
    ])
    // The providers row registers the built-in presets (two NInfer, three
    // Hyper-Qwen tiers, one Basalt Blackwell per model) alongside the
    // hardware guidelines.
    expect(ctx.localInfer.registeredPresets()).toHaveLength(7)
    // The providers row registers the built-in hardware guidelines.
    expect(ctx.localInfer.registeredGuidelines().map((guideline) => guideline.id)).toEqual([
      'docker-not-installed',
      'host-tiers-exceed-host-ram',
      'wsl2-dflash2-needs-pin-memory',
      'infernix-dflash2-needs-draft-model',
      'basalt-needs-blackwell',
    ])
  })

  it('declares the orchestrator row disabled in both patch copies', () => {
    const rootRows = patchRows(
      fileURLToPath(new URL('../../../cordis.patch.yml', import.meta.url)),
    )
    const bundleRows = patchRows(
      fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)),
    )
    // The two copies declare the same rows in the same order.
    expect(bundleRows.map((row) => row.id)).toEqual(rootRows.map((row) => row.id))
    // The carrier row mounts the bare package name (no subpath) so the
    // client-module scan reaches dsh/client.js; it is not a component. The
    // orchestrator is the fifth component row and the only one shipped
    // disabled, so a fresh install has the component off; the Plugins page
    // Components toggle writes the enabling override for the same row id at
    // the profile patch layer.
    const fifthComponentRow = (rows: PatchRow[]): PatchRow | undefined =>
      rows.filter((row) => row.name.includes('/'))[4]
    expect(fifthComponentRow(rootRows)).toEqual(orchestratorRow)
    expect(fifthComponentRow(bundleRows)).toEqual(orchestratorRow)
  })
})
