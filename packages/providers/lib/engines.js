/**
 * EngineInfo is the static, UI-facing description of one local-inference
 * engine: its id, display label, the deploy modes it supports, and the
 * ParameterSpec surface the form renderer draws. The data is the surface; the
 * concrete EngineAdapter (Phase 5) composes it into a LaunchPlan. The registry
 * is the single list the Web card offers, so adding an engine is a data edit
 * here, never a rewire of the card.
 * @module dsh-plugin-local-infer/providers/engines
 */
import { BASALT_PARAMETERS } from "./engines/basalt/basalt.js";
import { HYPERQWEN_PARAMETERS } from "./engines/hyperqwen/hyperqwen.js";
import { INFERNIX_PARAMETERS } from "./engines/infernix/infernix.js";
import { LLAMACPP_PARAMETERS } from "./engines/llamacpp/llamacpp.js";
import { NINFER_PARAMETERS } from "./engines/ninfer/ninfer.js";
import { STRATA_PARAMETERS } from "./engines/strata/strata.js";
/**
 * The engines the Web card offers, in the order the card lists them. NInfer,
 * Hyper-Qwen, Infernix, llama.cpp, Strata, and Basalt all carry parameter
 * surfaces (llama.cpp's is the specified set the plan names, verified when the
 * binary lands); Strata's surface is the `strata launch` flags and it supports
 * all three build modes (docker, source build, and the binary install);
 * Basalt's surface is the `basalt_config.json` settings and it is local-build
 * only (the C++/CUDA engine ships no container image).
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
        parameters: LLAMACPP_PARAMETERS,
    },
    {
        id: 'infernix',
        label: 'Infernix',
        supports: { docker: false, local: true },
        parameters: INFERNIX_PARAMETERS,
    },
    {
        id: 'strata',
        label: 'Strata',
        supports: { docker: true, local: true, binary: true },
        parameters: STRATA_PARAMETERS,
    },
    {
        // Basalt is the C++/CUDA engine for the Qwen3.8-Flash-Next MoE model,
        // Blackwell-only: a local source build, no container image.
        id: 'basalt',
        label: 'Basalt',
        supports: { docker: false, local: true },
        parameters: BASALT_PARAMETERS,
    },
];
//# sourceMappingURL=engines.js.map
