/**
 * The pure, framework-free domain model for the dsh local-inference plugin.
 * Every engine and model composes these same primitives; the estimator and the
 * guideline engine consume the declarations a ParameterSpec carries, so a new
 * engine, model, or rule is data and a thin subclass, never a core rewire.
 * @module @dsh/dsh-plugin-local-infer/core
 */
export { detectHardware, parseNvidiaSmiGpu, } from "./hardware.js";
export { estimateVram, KV_PAGE_TOKENS, pageRoundUp, TIGHT_HEADROOM_BYTES, } from "./estimator.js";
export { EngineAdapter } from "./adapter.js";
export { constraintId, evaluateGuidelines, modelGuidelines } from "./guideline.js";
//# sourceMappingURL=index.js.map