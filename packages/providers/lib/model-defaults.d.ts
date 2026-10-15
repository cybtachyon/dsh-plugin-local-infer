/**
 * The plugin's default model list. One entry per (engine, model) the card's
 * Model dropdown offers: the NInfer nvfp4 27B and 35B-A3B artifacts, the
 * Hyper-Qwen W4A16 27B and AWQ 35B-A3B artifacts, and the llama.cpp GGUF 27B
 * and 35B-A3B artifacts. Strata does not focus on the dense Qwen models, so it
 * carries no entry; the Qwen Flash Next defaults land with the engine.
 *
 * The list is the single source the card's Model dropdown, the model
 * presence check, and the hf CLI download route read. Adding a model is a
 * data edit here, never a route or card rewire.
 * @module dsh-plugin-local-infer/providers/model-defaults
 */
import type { DefaultModel } from 'dsh-plugin-local-infer/core';
/**
 * DEFAULT_MODELS is the default model list, in the order the card lists them.
 * The 27B keys reuse the VramModel registry ids; the 35B-A3B entries use the
 * `qwen36-35b` key, distinct from the measured `qwen3-35b` (the Qwen3.8 35B
 * artifact) so both 35B models can coexist in the config.
 */
export declare const DEFAULT_MODELS: readonly DefaultModel[];
/**
 * defaultModelsForEngine reads the default list for one engine id, in list
 * order. An engine with no entry (Strata) reads as an empty list, which the
 * card renders as no Model row.
 */
export declare function defaultModelsForEngine(engineId: string): readonly DefaultModel[];
/**
 * defaultModelFor resolves the default entry for one (engine, model) pair, or
 * undefined when no entry names the pair. The download route rejects an
 * undefined entry with a 404, so a model no default names never downloads.
 */
export declare function defaultModelFor(engineId: string, modelId: string): DefaultModel | undefined;
//# sourceMappingURL=model-defaults.d.ts.map