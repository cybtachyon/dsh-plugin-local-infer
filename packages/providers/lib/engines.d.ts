/**
 * EngineInfo is the static, UI-facing description of one local-inference
 * engine: its id, display label, the deploy modes it supports, and the
 * ParameterSpec surface the form renderer draws. The data is the surface; the
 * concrete EngineAdapter (Phase 5) composes it into a LaunchPlan. The registry
 * is the single list the Web card offers, so adding an engine is a data edit
 * here, never a rewire of the card.
 * @module dsh-plugin-local-infer/providers/engines
 */
import type { ParameterSpec } from 'dsh-plugin-local-infer/core';
export interface EngineInfo {
    id: string;
    label: string;
    supports: {
        docker: boolean;
        local: boolean;
    };
    parameters: readonly ParameterSpec[];
}
/**
 * The engines the Web card offers, in the order the card lists them. NInfer,
 * Hyper-Qwen, and llama.cpp carry parameter surfaces (llama.cpp's is the
 * specified set the plan names, verified when the binary lands); Strata is the
 * placeholder engine, its surface empty until the engine's flag set lands.
 */
export declare const ENGINES: readonly EngineInfo[];
//# sourceMappingURL=engines.d.ts.map