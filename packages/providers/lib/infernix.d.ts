/**
 * Infernix parameter surface. The declarative `ParameterSpec` data for the
 * Infernix engine (https://github.com/wallawalla47/infernix), a C++/CUDA
 * fork of NInfer tuned for Qwen models on a single RTX 50-series GPU,
 * sourced from the project's `docs/cli.md` and `docs/serving.md`. The
 * spelling is an `infernix-serve` CLI flag the `InfernixAdapter` passes onto
 * the process.
 *
 * The surface carries the flags the NInfer surface shares (KV format,
 * context, speculation, sampling) plus the Infernix-only fields: the
 * `--ngram-volume` PLE table for Qwen3.8-Flash-Next, the `--draft-model`
 * DFlash2 companion drafter, the n-gram copy proposal set, the offloaded-
 * expert memory tiers, and the quality routes. Those fields live only on
 * this surface, so the form renderer shows them only while the Infernix
 * engine is selected, and the adapters of the other engines never spell
 * them. Adding a flag here is a data edit, never a core rewire.
 * @module dsh-plugin-local-infer/providers/infernix
 */
import type { Config, EnumOption, ParameterSpec } from 'dsh-plugin-local-infer/core';
/**
 * The KV cache quantization formats Infernix serves, in the order the form
 * dropdown lists them. The set differs from NInfer's: the 2-bit and 4-bit-
 * K vector-quantized tiers (vq2, k4v2) replace the KVarN rk tiers, and both
 * hold three to four times the context of INT8 in the same VRAM.
 */
export declare const INFERNIX_KV_DTYPE_OPTIONS: readonly EnumOption[];
/**
 * The speculative-decoding backends. `none` loads no speculative backend at
 * all, which is the smallest resident profile.
 */
export declare const INFERNIX_SPEC_OPTIONS: readonly EnumOption[];
/**
 * The PLE n-gram table residency modes for Qwen3.8-Flash-Next. `auto` takes
 * pinned RAM only when the RAM ledger keeps every expert in RAM beside it.
 */
export declare const INFERNIX_NGRAM_RESIDENCY_OPTIONS: readonly EnumOption[];
/**
 * The reasoning-loop guard modes. The guard ends a reply, or closes the
 * thinking, when the open thinking keeps repeating whole passages.
 */
export declare const INFERNIX_REASONING_LOOP_OPTIONS: readonly EnumOption[];
/**
 * The gate message the form shows while the speculation fields are greyed
 * out. It names the fix (pick a backend) and the backends that unlock the
 * fields, so a first-time user knows the next click, not just the constraint.
 */
export declare const SPEC_GATE_MESSAGE = "Pick a speculation backend first (mtp, dflash, or dflash2)";
/**
 * The gate message the form shows while the dflash2-only fields are greyed
 * out. It names the fix (pick dflash2) and the reason, so a first-time user
 * knows the next click, not just the constraint.
 */
export declare const DFLASH2_GATE_MESSAGE = "Pick the dflash2 speculation backend first; the DFlash2 drafter loads with dflash2";
/**
 * InfernixModelArtifact is the per-model deploy data: the `.infernix` (or
 * `.ninfer`) artifact files, the Hugging Face repo the model download pulls
 * them from, and the model id the server advertises on its OpenAI endpoint.
 * A multi-file artifact (Qwen3.8-Flash-Next) names every shard in `files`
 * and the engine loads the first shard from the model directory. The data
 * is the surface; adding a model is a data edit here, never an adapter
 * rewire.
 */
export interface InfernixModelArtifact {
    file: string;
    files?: string[];
    repo: string;
    modelId: string;
}
/**
 * The Infernix model artifacts, keyed by the config model key. The 27B
 * NVIDIA NVFP4 entry is the default the DEFAULT_MODELS list names; an id no
 * entry names falls back to it, so a bare config always renders a plan. The
 * Flash-Next entry is the recommended Dense8 conversion: its download pulls
 * the whole repo, which carries the FP8 n-gram volume beside the shards, so
 * the `--ngram-volume` flag points at a file the same download left on disk.
 */
export declare const INFERNIX_MODEL_ARTIFACTS: Record<string, InfernixModelArtifact>;
/**
 * InfernixDFlash2Model is one common DFlash2 drafter the form's DFlash2 model
 * dropdown offers: the `.infernix` artifact file the hf CLI pulls, the Hugging
 * Face repo it lives in, and the label the dropdown shows. The DFlash2 drafter
 * is a companion model that runs beside a Flash-Next conversion, so it
 * downloads separately from the main model and loads through `--draft-model`.
 * The data is the surface; adding a drafter is a data edit here, never an
 * adapter rewire.
 */
export interface InfernixDFlash2Model {
    file: string;
    repo: string;
    label: string;
}
/**
 * The common DFlash2 drafters the Infernix DFlash2 model dropdown offers, in
 * dropdown order. The Flash-Next DFlash2 is Inco AI's drafter (the 776 MB
 * `.infernix` artifact) that the Infernix README recommends beside any
 * Flash-Next conversion. The list is the single source the dropdown, the
 * `--draft-model` path resolver, and the Get download step read.
 */
export declare const INFERNIX_DFLASH2_MODELS: readonly InfernixDFlash2Model[];
/**
 * The dropdown value the DFlash2 model field's Custom entry carries. A
 * selection of this value (or no selection) makes the effective `--draft-model`
 * path fall through to the Draft model path field, so a drafter no list entry
 * names still loads.
 */
export declare const DFLASH2_CUSTOM_VALUE = "custom";
/**
 * dflash2PresetOptions renders the DFlash2 model dropdown options: one entry
 * per common drafter (the label, the repo as the note) plus the Custom entry
 * last. The option value is the drafter's artifact file, so the selection
 * resolves back to the model data by file name.
 */
export declare function dflash2PresetOptions(): readonly EnumOption[];
/**
 * InfernixNgramVolume is the PLE n-gram table a model key reads: the `.ngram`
 * file and the Hugging Face repo the Get step pulls it from. The volume is kept
 * apart from the model shards and read from an NVMe drive, so the
 * `--ngram-volume` flag points at a file the same download leaves on disk.
 */
export interface InfernixNgramVolume {
    file: string;
    repo: string;
}
/**
 * The PLE n-gram volumes, keyed by the config model key. The Flash-Next entry
 * is the FP8 volume (the recommended one), which ships beside the Dense8 model
 * shards in the same repo, so a Get of the Flash-Next model pulls the table
 * into the model directory.
 */
export declare const INFERNIX_NGRAM_VOLUMES: Record<string, InfernixNgramVolume>;
/**
 * infernixDraftModelPath resolves the effective `--draft-model` path a config
 * carries: the selected DFlash2 preset's artifact (the model directory plus the
 * drafter file, the layout the hf CLI download leaves) when a preset is
 * selected, else the Custom Draft model path field. Returns null when neither
 * names a path, which is the misconfiguration the dflash2 guideline names.
 */
export declare function infernixDraftModelPath(config: Config): string | null;
/**
 * infernixGetDownloads renders the hf CLI download commands a Get run pulls
 * for a config: the selected DFlash2 drafter (into the model directory, the
 * layout the `--draft-model` path expects) when a preset is selected, and the
 * model key's PLE n-gram volume (into the model directory) when the key names
 * one. The commands are the single source the Get route streams, so a Get
 * leaves the model directory ready to launch.
 */
export declare function infernixGetDownloads(config: Config, modelDir: string): string[];
/**
 * The Infernix `ParameterSpec` surface, in form order. The `group` field is
 * the form section; specs without a group render under `General`. The
 * Infernix-only fields (ngramVolume, draftModel, the n-gram proposal set,
 * the expert memory tiers, the quality routes) appear only on this surface,
 * so the form shows them only while the Infernix engine is selected.
 */
export declare const INFERNIX_PARAMETERS: readonly ParameterSpec[];
/**
 * The Infernix model key a config carries: the string model value, falling
 * back to the 27B artifact key so a bare config always renders a plan. A
 * value that names a local artifact file (a directory-scanned model, a
 * `.ninfer` or `.infernix` name) passes through unchanged.
 */
export declare function infernixModelKey(config: Config): string;
/**
 * infernixArtifactFor resolves the artifact a model key deploys. A key that
 * names a local artifact file passes through the artifact map's 27B entry
 * for the model id, and an id no entry names falls back to the 27B entry, so
 * a bare config always renders a plan.
 */
export declare function infernixArtifactFor(modelKey: string): InfernixModelArtifact;
//# sourceMappingURL=infernix.d.ts.map