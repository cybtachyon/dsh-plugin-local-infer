/**
 * WarningsModel is the render model the Web panel draws the red hardware
 * warnings from: a summary banner and the per-field inline warnings the form
 * places next to the anchored parameter. The model is pure data, so the
 * panel (Phase 8) renders it without touching the domain model, and the
 * level-to-tone mapping stays unit-testable here. An `error` result renders
 * red; `warn` renders amber; `info` renders neutral.
 * @module dsh-plugin-local-infer/ui/warnings
 */

import type { GuidelineLevel, GuidelineResult } from 'dsh-plugin-local-infer/core'

/**
 * WarningTone is the panel's color class for a fired guideline: red for an
 * error, amber for a warning, neutral for an info.
 */
export type WarningTone = 'red' | 'amber' | 'neutral'

/**
 * One rendered warning: the fired guideline plus the tone the panel paints
 * it in and the parameter keys it renders next to.
 */
export interface WarningModel {
  id: string
  level: GuidelineLevel
  tone: WarningTone
  message: string
  anchors: string[]
}

/**
 * The summary banner: visible while any rule fired, painted in the worst
 * level present, carrying every fired warning in result order.
 */
export interface WarningBannerModel {
  visible: boolean
  level: GuidelineLevel | null
  count: number
  warnings: WarningModel[]
}

/**
 * The whole warning set: the banner plus the inline map keyed by parameter
 * key, so a field renders exactly the warnings anchored to it. A result
 * with no anchors reaches the banner only.
 */
export interface WarningsModel {
  banner: WarningBannerModel
  inline: Record<string, WarningModel[]>
}

/**
 * toneFor maps a guideline level to the panel's color class.
 */
export function toneFor(level: GuidelineLevel): WarningTone {
  switch (level) {
    case 'error':
      return 'red'
    case 'warn':
      return 'amber'
    case 'info':
      return 'neutral'
  }
}

/**
 * The worst level in a list, for the banner color: error outranks warn,
 * warn outranks info.
 */
function worstLevel(levels: readonly GuidelineLevel[]): GuidelineLevel | null {
  if (levels.some((level) => level === 'error')) return 'error'
  if (levels.some((level) => level === 'warn')) return 'warn'
  return levels.length > 0 ? 'info' : null
}

/**
 * renderWarnings builds the render model for a guideline result list. The
 * banner carries every fired warning; the inline map groups them by anchor
 * key so the form renders each warning next to the parameter it names.
 */
export function renderWarnings(results: readonly GuidelineResult[]): WarningsModel {
  const warnings: WarningModel[] = results.map((result) => ({
    id: result.id,
    level: result.level,
    tone: toneFor(result.level),
    message: result.message,
    anchors: result.anchors ?? [],
  }))

  const inline: Record<string, WarningModel[]> = {}
  for (const warning of warnings) {
    for (const anchor of warning.anchors) {
      const bucket = inline[anchor]
      if (bucket === undefined) {
        inline[anchor] = [warning]
      } else {
        bucket.push(warning)
      }
    }
  }

  return {
    banner: {
      visible: warnings.length > 0,
      level: worstLevel(warnings.map((warning) => warning.level)),
      count: warnings.length,
      warnings,
    },
    inline,
  }
}
