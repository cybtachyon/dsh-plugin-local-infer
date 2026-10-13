/**
 * EngineInfo is the static, UI-facing description of one local-inference
 * engine: its id, display label, the deploy modes it supports, and the
 * ParameterSpec surface the form renderer draws. The data is the surface; the
 * concrete EngineAdapter (Phase 5) composes it into a LaunchPlan. The registry
 * is the single list the Web card offers, so adding an engine is a data edit
 * here, never a rewire of the card.
 * @module @dsh/dsh-plugin-local-infer/providers/engines
 */
import { HYPERQWEN_PARAMETERS } from "./hyperqwen.js";
import { NINFER_PARAMETERS } from "./ninfer.js";
/**
 * The engines the Web card offers, in the order the card lists them. NInfer and
 * Hyper-Qwen carry measured parameter surfaces; llama.cpp and Strata land their
 * surfaces in a later phase, so they render an empty form until then.
 */
export const ENGINES = [
    {
        id: 'ninfer',
        label: 'NInfer',
        supports: { docker: true, local: true },
        parameters: NINFER_PARAMETERS,
    },
    {
        id: 'hyperqwen',
        label: 'Hyper-Qwen',
        supports: { docker: true, local: false },
        parameters: HYPERQWEN_PARAMETERS,
    },
    {
        id: 'llamacpp',
        label: 'llama.cpp',
        supports: { docker: true, local: true },
        parameters: [],
    },
    {
        id: 'strata',
        label: 'Strata',
        supports: { docker: true, local: false },
        parameters: [],
    },
];
//# sourceMappingURL=engines.js.map