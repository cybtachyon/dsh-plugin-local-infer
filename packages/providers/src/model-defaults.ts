/**
 * The plugin's default model list. One entry per (engine, model) the card's
 * Model dropdown offers: the NInfer nvfp4 27B and 35B-A3B artifacts, the
 * Hyper-Qwen W4A16 27B and AWQ 35B-A3B artifacts, the llama.cpp GGUF 27B and
 * 35B-A3B artifacts, and the Infernix 27B NVIDIA NVFP4 and the Qwen3.8-
 * Flash-Next Dense8 conversion (whose whole-repo download carries the FP8
 * n-gram volume the `--ngram-volume` flag reads). Strata carries the two
 * models the README's Models section links (Gyro and DeepSeek V4.1-Flash),
 * each named by the model the engine accepts and the repo it downloads.
 *
 * The list is the single source the card's Model dropdown, the model
 * presence check, and the hf CLI download route read. Adding a model is a
 * data edit here, never a route or card rewire.
 * @module dsh-plugin-local-infer/providers/model-defaults
 */

import type { DefaultModel } from 'dsh-plugin-local-infer/core'

/**
 * DEFAULT_MODELS is the default model list, in the order the card lists them.
 * The 27B keys reuse the VramModel registry ids; the 35B-A3B entries use the
 * `qwen36-35b` key, distinct from the measured `qwen3-35b` (the Qwen3.8 35B
 * artifact) so both 35B models can coexist in the config.
 */
export const DEFAULT_MODELS: readonly DefaultModel[] = [
  {
    engineId: 'ninfer',
    modelId: 'qwen3-27b',
    label: 'Ninfer Qwen3.8-27B',
    url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
    file: 'qwen3_8_27b_nvfp4.ninfer',
  },
  {
    engineId: 'ninfer',
    modelId: 'qwen3-27b-swift15',
    label: 'Ninfer Qwen3.8-27B (Swift 1.5)',
    url: 'https://huggingface.co/kaushikvira/Qwen3.8-27B-swift15-uncensored-ajgazin-nvfp4full-dflash2-NInfer-v3',
    file: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
  },
  {
    engineId: 'ninfer',
    modelId: 'qwen36-35b',
    label: 'Ninfer Qwen3.6-35B',
    url: 'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
    file: 'qwen3_6_35b_a3b.ninfer',
  },
  {
    engineId: 'hyperqwen',
    modelId: 'qwen3-27b',
    label: 'HyperQwen Qwen3.8-27B',
    url: 'https://huggingface.co/born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
  },
  {
    engineId: 'hyperqwen',
    modelId: 'qwen36-35b',
    label: 'HyperQwen Qwen3.6-35B',
    url: 'https://huggingface.co/QuantTrio/Qwen3.6-35B-A3B-AWQ',
  },
  {
    engineId: 'llamacpp',
    modelId: 'qwen3-27b',
    label: 'llama.cpp Qwen3.8-27B',
    url: 'https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF',
    file: 'Qwen3.8-27B-Q4_K_M.gguf',
  },
  {
    engineId: 'llamacpp',
    modelId: 'qwen36-35b',
    label: 'llama.cpp Qwen3.6-35B',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF',
    file: 'Qwen3.6-35B-A3B-Q4_K_M.gguf',
  },
  {
    engineId: 'infernix',
    modelId: 'qwen3-27b',
    label: 'Infernix Qwen3.8-27B',
    url: 'https://huggingface.co/Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3',
    file: 'qwen3_8_27b_nvfp4-nvidia.ninfer',
  },
  {
    engineId: 'infernix',
    modelId: 'qwen38-flash-next',
    label: 'Infernix Qwen3.8-Flash-Next (Dense8)',
    // No single file: the download pulls the whole repo, which carries the
    // three model shards, the FP8 n-gram volume, and the conversion metadata.
    url: 'https://huggingface.co/Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix',
  },
  {
    engineId: 'infernix',
    modelId: 'qwen36-35b',
    label: 'Infernix Qwen3.6-35B',
    url: 'https://huggingface.co/neroued/Qwen3.6-35B-A3B-NInfer',
    file: 'qwen3_6_35b_a3b.ninfer',
  },
  // The two models the Strata README's Models section links: Gyro (the
  // smallest way to run Qwen3.8-Flash-Next) and DeepSeek V4.1-Flash (the
  // bigger model that runs on one 12 GB card). No single file: the engine
  // downloads the model itself (into the container volume or its data dir),
  // so the entry names the repo only.
  {
    engineId: 'strata',
    modelId: 'gyro-s',
    label: 'Strata Gyro-S (Qwen3.8-Flash-Next)',
    url: 'https://huggingface.co/agentionai/Qwen3.8-Flash-Next-Gyro-GGUF',
  },
  {
    engineId: 'strata',
    modelId: 'ist-das-2.00bpw',
    label: 'Strata DeepSeek V4.1-Flash (2.00 bpw)',
    url: 'https://huggingface.co/ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF',
  },
]

/**
 * defaultModelsForEngine reads the default list for one engine id, in list
 * order. An engine with no entry reads as an empty list, which the card
 * renders as no Model row.
 */
export function defaultModelsForEngine(engineId: string): readonly DefaultModel[] {
  return DEFAULT_MODELS.filter((entry) => entry.engineId === engineId)
}

/**
 * defaultModelFor resolves the default entry for one (engine, model) pair, or
 * undefined when no entry names the pair. The download route rejects an
 * undefined entry with a 404, so a model no default names never downloads.
 */
export function defaultModelFor(engineId: string, modelId: string): DefaultModel | undefined {
  return DEFAULT_MODELS.find((entry) => entry.engineId === engineId && entry.modelId === modelId)
}
