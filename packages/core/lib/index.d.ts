/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module @dsh/dsh-plugin-local-infer/core
 */
export type { Config } from './config.ts';
export { detectHardware, parseNvidiaSmiGpu, } from './hardware.ts';
export type { GpuProfile, GpuProbe, HardwareProfile, HardwareProbes, } from './hardware.ts';
export type { ComboOption, ConstraintResult, EnumOption, ParameterForm, ParameterSpec, } from './parameter.ts';
export { DEFAULT_OS_RESERVE_MIB, estimateVram, KV_PAGE_TOKENS, pageRoundUp, TIGHT_HEADROOM_BYTES, } from './estimator.ts';
export type { EstimateContext, SpeculationTerms, VramBreakdown, VramContribution, VramEstimate, VramModel, VramVerdict, } from './estimator.ts';
export { EngineAdapter } from './adapter.ts';
export type { DeployResult, HealthResult, LaunchPlan } from './adapter.ts';
export { constraintId, evaluateGuidelines, modelGuidelines } from './guideline.ts';
export type { Guideline, GuidelineLevel, GuidelineResult } from './guideline.ts';
export type { DefaultProvenance, DefaultsResolver, HardwareClass, Preset, } from './defaults.ts';
export type { DshModelEntry, DshModelRegistrar, RegisterResult } from './registrar.ts';
export type { DepCheck, DepStatus, InstallResult, SystemDep, SystemDepProvisioner, } from './deps.ts';
//# sourceMappingURL=index.d.ts.map