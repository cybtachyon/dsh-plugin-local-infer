/**
 * Basalt parameter surface. The declarative `ParameterSpec` data for the
 * Basalt engine (https://github.com/jesdga95/basalt), sourced from the
 * repository's `docs/configuration/index.md`. Basalt is a C++/CUDA engine
 * for the Qwen3.8-Flash-Next and DeepSeek-V4.1-Flash MoE models,
 * Blackwell-only (sm_120). Every setting lands in a v2
 * `basalt_config.json` file the deploy step writes, so each spec carries a
 * `config` deploy target naming where the value nests: the shared `server`
 * options, the per-model settings of the single `models[]` entry, or the
 * shared `engine` flags; the `BasaltAdapter` (TASK 011) renders the file
 * with `configFileFromSpecs` and passes it to `basalt serve --config`.
 *
 * The data is the surface; the adapter composes it into a `LaunchPlan`.
 * Adding a setting here is a data edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basalt
 */
import type { ComboOption, Config, EnumOption, ParameterSpec } from 'dsh-plugin-local-infer/core';
/**
 * The Hugging Face repo and file of the bundled Qwen `.basalt` artifact
 * (the weights, tokenizer, chat template, drafter, vision projector, and
 * default sampling all come from it), the one a bare config serves. The
 * constants live in this leaf module so both the adapter and the default
 * model list import them without a circular edge.
 */
export declare const BASALT_MODEL_REPO = "jesdga/Qwen3.8-Flash-Next-Basalt";
export declare const BASALT_MODEL_FILE = "Qwen3.8-FN-NVFP4-DQ6_K.basalt";
/**
 * The Hugging Face repo and file of the second `.basalt` artifact the
 * engine serves: the DeepSeek-V4.1-Flash UD-IQ1_M pack the v0.3.0 release
 * notes name. The registry key and the served API id ride beside them, so
 * the default model list, the VRAM and preset rows, the adapter's per-
 * artifact download resolution, and the entry's alias stamp all name the
 * same pack from one place.
 */
export declare const BASALT_DEEPSEEK_MODEL_REPO = "jesdga/DeepSeek-V4.1-Flash-1017-Basalt";
export declare const BASALT_DEEPSEEK_MODEL_FILE = "DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt";
/**
 * The `basalt_config.json` format version the adapter's render envelope
 * stamps under the top-level `version` key. v0.3.0 refuses a file without
 * the stamp as a v1 config; the adapter's envelope (TASK-003) reads this
 * constant, so the version lives beside the surface that re-blocked for it.
 */
export declare const BASALT_CONFIG_VERSION = 2;
/**
 * The loopback port the basalt serve CLI binds by default, so a config that
 * names no port launches on it. The port spec's defaultValue and the adapter's
 * port fallback share this one constant.
 */
export declare const BASALT_DEFAULT_PORT = 8080;
/**
 * The model id of the default registry entry a bare config names: the
 * Qwen3.8-Flash-Next `.basalt` artifact the engine serves. The default
 * model list, the built-in preset key, the Basalt VramModel id, and the
 * adapter's plan modelId stamp all share this one constant, so every
 * model-id keyed read of the engine names the same model the card's Model
 * dropdown offers first.
 */
export declare const BASALT_DEFAULT_MODEL_ID = "qwen38-flash-next";
/**
 * The registry key and served API id of the second default entry, the
 * DeepSeek-V4.1-Flash UD-IQ1_M pack: `BASALT_DEEPSEEK_MODEL_ID` keys the
 * default model list, the VRAM row, and the preset row, while
 * `BASALT_DEEPSEEK_SERVED_MODEL_ID` is the name the adapter stamps as the
 * config entry's `alias` and the registrar publishes (basaltServedName).
 * The alias pins the name on `/v1/models` because the pack's stored
 * `meta.name` is not known to the plugin.
 */
export declare const BASALT_DEEPSEEK_MODEL_ID = "deepseek-v41-flash";
export declare const BASALT_DEEPSEEK_SERVED_MODEL_ID = "DeepSeek-V4.1-Flash";
/**
 * The model id the serve server reports the bundled Qwen artifact under:
 * the `meta.name` stored inside the `.basalt` artifact file. The adapter
 * stamps it as the config entry's `alias` and the registrar publishes it
 * (basaltServedName), so `/v1/models` always lists this name and the
 * registry key and the file path are never advertised.
 */
export declare const BASALT_SERVED_MODEL_ID = "Qwen3.8-Flash-Next NVIDIA-NVFP4";
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
 * `config` deploy target naming its v2 `basalt_config.json` placement:
 * shared server options under `server`, per-model settings merged into the
 * single `models[]` entry, and shared engine flags under `engine`. The
 * multi-word keys name their flag spelling in `deploy.key`; the config
 * parser lowercases the key and turns `_` into `-`, so the dash form is the
 * one it matches.
 */
export declare const BASALT_PARAMETERS: readonly ParameterSpec[];
/**
 * The Basalt model key a config carries: the string `.basalt` model path,
 * falling back to an empty string so a bare config renders a plan the
 * adapter fills in with the downloaded model file. A value that names a
 * local artifact path passes through unchanged.
 */
export declare function basaltModelKey(config: Config): string;
/**
 * basaltServedName returns the model name a `.basalt` artifact answers to
 * at the API: the name the serve server reports and `/v1/models` lists
 * (the config entry's `alias`, stamped from here), and a request may
 * equally name the artifact's own file name. The two artifacts the default
 * list carries map to their published served ids, because each pack's
 * stored `meta.name` is not knowable to the plugin for arbitrary files;
 * any other artifact file answers to its basename, the engine's own
 * file-name rule. Takes the resolved artifact file (the name or path
 * `basaltModelFileName` produces); the adapter's `modelRef` and
 * `renderLaunch` alias stamp both call it, so the published id and the
 * served alias cannot drift apart.
 */
export declare function basaltServedName(modelValue: string): string;
//# sourceMappingURL=basalt.d.ts.map
