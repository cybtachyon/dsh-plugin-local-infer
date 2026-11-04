/**
 * Basalt parameter surface. The declarative `ParameterSpec` data for the
 * Basalt engine (https://github.com/jesdga95/basalt), sourced from the
 * repository's `docs/configuration/index.md`. Basalt is a C++/CUDA engine
 * for the Qwen3.8-Flash-Next MoE model, Blackwell-only (sm_120). Every
 * setting lands in a `basalt_config.json` file the deploy step writes, so
 * each spec carries a `config` deploy target naming the `server` or
 * `engine` block the value nests under; the `BasaltAdapter` (TASK 011)
 * renders the file with `configFileFromSpecs` and passes it to
 * `basalt serve --config`.
 *
 * The data is the surface; the adapter composes it into a `LaunchPlan`.
 * Adding a setting here is a data edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basalt
 */
import type { ComboOption, Config, EnumOption, ParameterSpec } from 'dsh-plugin-local-infer/core';
/**
 * The Hugging Face repo and file the deploy step downloads into the model
 * directory: the single `.basalt` artifact the engine serves (the weights,
 * tokenizer, chat template, drafter, vision projector, and default
 * sampling all come from it). The constants live in this leaf module so
 * both the adapter and the default model list import them without a
 * circular edge.
 */
export declare const BASALT_MODEL_REPO = "jesdga/Qwen3.8-Flash-Next-Basalt";
export declare const BASALT_MODEL_FILE = "Qwen3.8-FN-NVFP4-DQ6_K.basalt";
/**
 * The KV cache storage formats Basalt serves, in the order the form
 * dropdown lists them. `note` carries the tradeoff text the dropdown shows
 * beside each choice.
 */
export declare const BASALT_KV_OPTIONS: readonly EnumOption[];
/**
 * The image-input modes. `off` reads no pictures; `dynamic` borrows
 * expert-cache slots inside the engine only while it reads an image; `cpu`
 * runs the encoder on the CPU (no VRAM, slow). A GPU number pins the
 * encoder sidecar to that card; the combo control offers the three named
 * modes and accepts a free-text GPU number.
 */
export declare const BASALT_VISION_OPTIONS: readonly ComboOption[];
/**
 * The expert-cache sizes. `auto` takes as many expert blobs as fit in the
 * VRAM left after the weights, the session and the reserve; a free-text
 * count pins the number of blobs. The combo control offers `auto` and
 * accepts a free-text count.
 */
export declare const BASALT_EXPERT_CACHE_OPTIONS: readonly ComboOption[];
/**
 * The Basalt `ParameterSpec` surface, in form order. Every spec carries a
 * `config` deploy target: the value nests under the `server` or `engine`
 * block of the `basalt_config.json` the deploy step writes. The multi-word
 * engine keys name their flag spelling in `deploy.key`; the config parser
 * lowercases the key and turns `_` into `-`, so the dash form is the one it
 * matches.
 */
export declare const BASALT_PARAMETERS: readonly ParameterSpec[];
/**
 * The Basalt model key a config carries: the string `.basalt` model path,
 * falling back to an empty string so a bare config renders a plan the
 * adapter fills in with the downloaded model file. A value that names a
 * local artifact path passes through unchanged.
 */
export declare function basaltModelKey(config: Config): string;
//# sourceMappingURL=basalt.d.ts.map
