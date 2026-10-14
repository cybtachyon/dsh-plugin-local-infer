import { estimateVram } from './estimator.ts'
import type { EstimateOptions, VramModel } from './estimator.ts'
import type { Config } from './config.ts'
import type { HardwareProfile } from './hardware.ts'
import type { ParameterSpec } from './parameter.ts'

/**
 * GuidelineLevel is the severity a fired guideline carries. `error` renders
 * red, inline to the anchored parameter and in the summary banner.
 */
export type GuidelineLevel = 'info' | 'warn' | 'error'

/**
 * Guideline is a named rule that inspects a parameter value, or the presence
 * of a parameter, and returns a severity. This directly serves the requirement
 * to warn when parameter values OR parameters themselves are a problem for
 * the hardware. The `when` probe sees the config and the hardware, so a rule
 * can gate on a value, on the hardware, or on both. `anchors` names the
 * parameter keys the UI places the warning next to; a rule with no anchors
 * renders in the summary banner only.
 */
export interface Guideline {
  id: string
  when: (config: Config, hw: HardwareProfile, spec?: ParameterSpec) => boolean
  level: GuidelineLevel
  message: string
  anchors?: string[]
}

/**
 * GuidelineResult is one fired guideline, with the parameter keys it anchors
 * to for inline placement in the form.
 */
export interface GuidelineResult {
  id: string
  level: GuidelineLevel
  message: string
  anchors?: string[]
}

/**
 * The result id a per-spec hardwareConstraint failure carries. The `constraint:`
 * prefix keeps spec-derived results distinct from registered guideline ids,
 * so a rule and a constraint can never collide in the result list.
 */
export function constraintId(key: string): string {
  return `constraint:${key}`
}

/**
 * evaluateGuidelines is the guideline engine: it runs every registered
 * guideline and every per-spec `hardwareConstraint` against one config and
 * one hardware profile, and returns the fired results. The named guidelines
 * run first in the order given, then the spec constraints in spec order, so
 * the result list is deterministic. A spec constraint runs on the config
 * value, falling back to the spec default like the estimator does; a spec
 * with neither a config value nor a default is absent and fires nothing,
 * which keeps a foreign engine's surface from warning on a config it does
 * not own.
 */
export function evaluateGuidelines(
  guidelines: readonly Guideline[],
  specs: readonly ParameterSpec[],
  config: Config,
  hw: HardwareProfile,
): GuidelineResult[] {
  const results: GuidelineResult[] = []
  for (const guideline of guidelines) {
    if (guideline.when(config, hw)) {
      results.push({
        id: guideline.id,
        level: guideline.level,
        message: guideline.message,
        ...(guideline.anchors !== undefined ? { anchors: guideline.anchors } : {}),
      })
    }
  }
  for (const spec of specs) {
    if (spec.hardwareConstraint === undefined) continue
    const raw = config[spec.key]
    const value = raw === undefined ? spec.defaultValue : raw
    if (value === undefined) continue
    const result = spec.hardwareConstraint(value, hw)
    if (!result.ok) {
      results.push({
        id: constraintId(spec.key),
        level: result.severity,
        message: result.message,
        anchors: [spec.key],
      })
    }
  }
  return results
}

/**
 * availableSpecNames lists the spec backend names a VramModel actually
 * measured, derived from its speculation table: `mtp3+head` reads as `mtp`,
 * `dflash2-7` as `dflash2`, `dflash-3` as `dflash`. A key that carries a
 * `-N` draft-count suffix (dflash2-7, dflash-3) drops only that suffix, so
 * the dflash2 version digit survives; a bare `mtp3` drops its trailing draft
 * count. The names feed the fix text of the draft-weights rule, so a model
 * that measured three backends names all three.
 */
function availableSpecNames(model: VramModel): string {
  const names = new Set<string>()
  for (const key of Object.keys(model.speculation ?? {})) {
    if (key === 'none') continue
    const noHead = key.replace('+head', '')
    const name = /-\d+$/.test(noHead) ? noHead.replace(/-\d+$/, '') : noHead.replace(/\d+$/, '')
    if (name.length > 0) names.add(name)
  }
  return [...names].sort().join(', ')
}

/**
 * modelGuidelines are the built-in rules only the service can price, because
 * they need the registered VramModel: the estimator-backed "exceeds usable
 * VRAM" rule and the "spec needs draft weights the artifact never measured"
 * rule. Both reuse `estimateVram` and the model's `specKey` mapping, so they
 * agree with the meter by construction. A config with no spec, or a spec the
 * model measured, fires nothing. The options carry the dynamically resolved
 * OS reserve, so the rule prices the same usable budget the meter does.
 */
export function modelGuidelines(
  model: VramModel,
  config: Config,
  hw: HardwareProfile,
  options?: EstimateOptions,
): GuidelineResult[] {
  const results: GuidelineResult[] = []

  const estimate = estimateVram(model, config, hw, undefined, options)
  if (estimate.verdict.status === 'over') {
    const largest = estimate.breakdown.largestFittingContext
    // The measured solver floors at 0 when even one token does not fit; the
    // not-measured path reads null. Both read as "no context fits".
    const fit =
      largest === null || largest === 0
        ? 'no context fits this card'
        : `the largest fitting context is ${largest} tokens`
    results.push({
      id: 'vram-exceeds-usable',
      level: 'error',
      message: `The context exceeds the usable VRAM: ${fit}. Lower the max context, pick a smaller KV format, or drop the spec backend.`,
      anchors: ['maxContext'],
    })
  }

  const spec = typeof config.spec === 'string' ? config.spec : undefined
  if (spec !== undefined && spec !== 'none') {
    const key = model.specKey ? model.specKey(config) : spec
    const measured = key !== undefined && key in (model.speculation ?? {})
    if (!measured) {
      const names = availableSpecNames(model)
      const pick =
        names.length > 0
          ? `Pick ${names}.`
          : 'No speculation backend is measured for this artifact.'
      results.push({
        id: 'spec-needs-draft-weights',
        level: 'error',
        message: `The ${spec} spec needs the draft companion weights the ${model.id} artifact does not carry. ${pick}`,
        anchors: ['spec'],
      })
    }
  }
  return results
}
