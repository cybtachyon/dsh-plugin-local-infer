/**
 * llama.cpp parameter surface. The declarative `ParameterSpec` data for the
 * llama.cpp engine, sourced from the `llama-server` CLI flag surface. The
 * concepts mirror the NInfer and Hyper-Qwen surfaces; the spelling is a
 * `llama-server` CLI flag the `LlamaCppAdapter` passes onto the process or
 * the docker container.
 *
 * The data is the surface; the `LlamaCppAdapter` (Phase 9) composes it into a
 * `LaunchPlan`. Adding a flag here is a data edit, never a core rewire. The
 * engine is not present on the reference host, so the surface is the
 * specified set the plan names, verified when the binary lands.
 * @module @dsh/dsh-plugin-local-infer/providers/llamacpp
 */
import type { Config, EnumOption, ParameterSpec } from '@dsh/dsh-plugin-local-infer/core';
/**
 * The KV cache quantization formats llama.cpp serves. `f16` is the full-
 * precision default; the smaller tiers trade a little quality for a longer
 * context in the same memory.
 */
export declare const KV_CACHE_TYPE_OPTIONS: readonly EnumOption[];
/**
 * LlamaCppModelArtifact is the per-model deploy data: the GGUF file, the
 * Hugging Face repo the model download pulls it from, and the model id the
 * server advertises on its OpenAI endpoint. The data is the surface; adding a
 * model is a data edit here, never an adapter rewire.
 */
export interface LlamaCppModelArtifact {
    file: string;
    repo: string;
    modelId: string;
}
/**
 * The llama.cpp model artifacts, keyed by the config model key. The 27B entry
 * is the default the DEFAULT_MODELS list names; an id no entry names falls
 * back to it, so a bare config always renders a plan.
 */
export declare const LLAMACPP_MODEL_ARTIFACTS: Record<string, LlamaCppModelArtifact>;
/**
 * The llama.cpp `ParameterSpec` surface, in form order. The `group` field is
 * the form section; specs without a group render under `General`. The `port`
 * the engine listens on is a config value the adapter reads (the NInfer
 * pattern), not a spec, so the docker plan maps the host port onto the
 * container's fixed internal port without a duplicate flag.
 */
export declare const LLAMACPP_PARAMETERS: readonly ParameterSpec[];
/**
 * The config value the llama.cpp adapter reads for the port and the model.
 * The port defaults to 8080, the llama.cpp default; the model defaults to the
 * 27B artifact key. A config that names neither renders a bare plan.
 */
export declare function llamaCppModelKey(config: Config): string;
//# sourceMappingURL=llamacpp.d.ts.map