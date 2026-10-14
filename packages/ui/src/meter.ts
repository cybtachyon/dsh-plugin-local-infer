/**
 * MeterModel is the render model the Web panel draws the VRAM Est. meter from:
 * a to-scale segmented bar (weights / KV / overhead / workspace / free / OS
 * reserve) against the full card, the verdict, the largest-fitting-context
 * readout, and the source label that keeps a measured number from being read
 * as authoritative. The model is pure data, so the panel (Phase 8) renders
 * it without touching the domain model, and the mapping stays unit-testable
 * here.
 * @module @dsh/dsh-plugin-local-infer/ui/meter
 */

import type {
  VramBreakdown,
  VramVerdict,
} from '@dsh/dsh-plugin-local-infer/core'

/**
 * MeterSegment is one segment of the to-scale bar. `percent` is the share of
 * the full card the segment occupies, so the bar reads against the card the
 * way the NInfer calculator draws it, with the OS reserve hatched at the far
 * end.
 */
export interface MeterSegment {
  key: 'weights' | 'kv' | 'overhead' | 'workspace' | 'free' | 'reserve'
  label: string
  bytes: number
  percent: number
}

/**
 * MeterModel is the whole meter: the segments in bar order, the card size the
 * percents are against, the verdict the banner renders, the largest-fitting-
 * context readout, and the source label (measured, estimated, or not-
 * measured) the panel shows so a number is never read as authoritative.
 */
export interface MeterModel {
  segments: MeterSegment[]
  cardBytes: number
  verdict: VramVerdict
  largestFittingContext: number | null
  source: 'measured' | 'estimated' | 'not-measured'
}

/**
 * renderMeter builds the render model for a VRAM estimate. The segments are
 * to-scale against the full card, so "free" on the bar means free to the user
 * rather than free minus whatever the desktop takes. A not-measured verdict
 * overrides the model's source label, so the meter never shows a measured or
 * estimated badge on a number it could not price.
 */
export function renderMeter(
  breakdown: VramBreakdown,
  verdict: VramVerdict,
  vramGiB: number,
  source: 'measured' | 'estimated' | 'not-measured',
): MeterModel {
  const cardBytes = vramGiB * 1024 * 1024 * 1024
  const percentOf = (bytes: number): number =>
    cardBytes > 0 ? Math.max(0, Math.min(100, (bytes / cardBytes) * 100)) : 0
  // The bar reads against the full card the way the NInfer calculator draws
  // it, with the OS reserve hatched at the far end.
  const segments: MeterSegment[] = [
    { key: 'weights', label: 'Weights', bytes: breakdown.weights, percent: percentOf(breakdown.weights) },
    { key: 'kv', label: 'KV cache', bytes: breakdown.kv, percent: percentOf(breakdown.kv) },
    { key: 'overhead', label: 'Sequence state', bytes: breakdown.overhead, percent: percentOf(breakdown.overhead) },
    { key: 'workspace', label: 'Workspace', bytes: breakdown.workspace, percent: percentOf(breakdown.workspace) },
    { key: 'free', label: 'Free for more context', bytes: breakdown.free, percent: percentOf(breakdown.free) },
    { key: 'reserve', label: 'Reserved for the OS', bytes: breakdown.reserve, percent: percentOf(breakdown.reserve) },
  ]
  return {
    segments,
    cardBytes,
    verdict,
    largestFittingContext: breakdown.largestFittingContext,
    source: verdict.status === 'not-measured' ? 'not-measured' : source,
  }
}
