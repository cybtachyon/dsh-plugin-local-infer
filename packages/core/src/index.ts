/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module @dsh/dsh-plugin-local-infer-core
 */

export type { Config } from './config.ts'
export type { GpuProfile, HardwareProfile } from './hardware.ts'
export type {
  ConstraintResult,
  EnumOption,
  ParameterForm,
  ParameterSpec,
} from './parameter.ts'
export type {
  EstimateContext,
  SpeculationTerms,
  VramBreakdown,
  VramContribution,
  VramModel,
  VramVerdict,
} from './estimator.ts'
export { EngineAdapter } from './adapter.ts'
export type { DeployResult, HealthResult, LaunchPlan } from './adapter.ts'
export type { Guideline, GuidelineResult } from './guideline.ts'
export type {
  DefaultProvenance,
  DefaultsResolver,
  HardwareClass,
  Preset,
} from './defaults.ts'
export type { DshModelEntry, DshModelRegistrar, RegisterResult } from './registrar.ts'
export type {
  DepCheck,
  DepStatus,
  InstallResult,
  SystemDep,
  SystemDepProvisioner,
} from './deps.ts'
