import type { EstimateOptions, VramModel } from './estimator.ts';
import type { Config } from './config.ts';
import type { HardwareProfile } from './hardware.ts';
import type { ParameterSpec } from './parameter.ts';
/**
 * GuidelineLevel is the severity a fired guideline carries. `error` renders
 * red, inline to the anchored parameter and in the summary banner.
 */
export type GuidelineLevel = 'info' | 'warn' | 'error';
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
    id: string;
    when: (config: Config, hw: HardwareProfile, spec?: ParameterSpec) => boolean;
    level: GuidelineLevel;
    message: string;
    anchors?: string[];
}
/**
 * GuidelineResult is one fired guideline, with the parameter keys it anchors
 * to for inline placement in the form.
 */
export interface GuidelineResult {
    id: string;
    level: GuidelineLevel;
    message: string;
    anchors?: string[];
}
/**
 * The result id a per-spec hardwareConstraint failure carries. The `constraint:`
 * prefix keeps spec-derived results distinct from registered guideline ids,
 * so a rule and a constraint can never collide in the result list.
 */
export declare function constraintId(key: string): string;
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
export declare function evaluateGuidelines(guidelines: readonly Guideline[], specs: readonly ParameterSpec[], config: Config, hw: HardwareProfile): GuidelineResult[];
/**
 * modelGuidelines are the built-in rules only the service can price, because
 * they need the registered VramModel: the estimator-backed "exceeds usable
 * VRAM" rule and the "spec needs draft weights the artifact never measured"
 * rule. Both reuse `estimateVram` and the model's `specKey` mapping, so they
 * agree with the meter by construction. A config with no spec, or a spec the
 * model measured, fires nothing. The options carry the dynamically resolved
 * OS reserve, so the rule prices the same usable budget the meter does.
 */
export declare function modelGuidelines(model: VramModel, config: Config, hw: HardwareProfile, options?: EstimateOptions): GuidelineResult[];
//# sourceMappingURL=guideline.d.ts.map