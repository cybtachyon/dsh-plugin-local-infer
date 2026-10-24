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

import type {
  Config,
  EnumOption,
  HardwareProfile,
  ParameterSpec,
} from 'dsh-plugin-local-infer/core'
import { CHAT_TEMPLATE_OPTIONS } from './ninfer.ts'

/**
 * The KV cache quantization formats Infernix serves, in the order the form
 * dropdown lists them. The set differs from NInfer's: the 2-bit and 4-bit-
 * K vector-quantized tiers (vq2, k4v2) replace the KVarN rk tiers, and both
 * hold three to four times the context of INT8 in the same VRAM.
 */
export const INFERNIX_KV_DTYPE_OPTIONS: readonly EnumOption[] = [
  { value: 'bf16', label: 'bf16', note: 'full precision; the widest KV pool' },
  { value: 'int8', label: 'int8', note: 'half the bytes of bf16; the everyday choice' },
  { value: 'fp8', label: 'fp8', note: 'half the bytes of bf16; the long-context tier' },
  { value: 'nvfp4', label: 'nvfp4', note: 'NVFP4; the smallest KV tier, needs SM 89 or newer' },
  { value: 'k8v4', label: 'k8v4', note: '8-bit keys, 4-bit values; between int8 and vq2' },
  { value: 'vq2', label: 'vq2', note: '2-bit vector-quantized K and V; the longest context tier' },
  { value: 'k4v2', label: 'k4v2', note: '4-bit K with 2-bit V; between k8v4 and vq2' },
] as const

/**
 * The speculative-decoding backends. `none` loads no speculative backend at
 * all, which is the smallest resident profile.
 */
export const INFERNIX_SPEC_OPTIONS: readonly EnumOption[] = [
  { value: 'none', label: 'none', note: 'no speculative backend; the smallest resident profile' },
  { value: 'mtp', label: 'mtp', note: 'multi-token-prediction head; the 27B and 35B-A3B choice' },
  { value: 'dflash', label: 'dflash', note: 'DFlash; the 35B-A3B companion-weight backend' },
  {
    value: 'dflash2',
    label: 'dflash2',
    note: 'DFlash2; the 27B and Flash-Next backend, the Flash-Next drafter rides --draft-model',
  },
] as const

/**
 * The PLE n-gram table residency modes for Qwen3.8-Flash-Next. `auto` takes
 * pinned RAM only when the RAM ledger keeps every expert in RAM beside it.
 */
export const INFERNIX_NGRAM_RESIDENCY_OPTIONS: readonly EnumOption[] = [
  {
    value: 'auto',
    label: 'auto',
    note: 'reads the table into RAM when the ledger allows, else from the volume',
  },
  { value: 'ram', label: 'ram', note: 'reads the whole table into pinned host RAM at startup' },
  { value: 'volume', label: 'volume', note: 'reads rows on demand from the n-gram volume' },
] as const

/**
 * The reasoning-loop guard modes. The guard ends a reply, or closes the
 * thinking, when the open thinking keeps repeating whole passages.
 */
export const INFERNIX_REASONING_LOOP_OPTIONS: readonly EnumOption[] = [
  { value: 'off', label: 'off', note: 'no guard; the engine default' },
  { value: 'stop', label: 'stop', note: 'ends the reply when the thinking repeats' },
  { value: 'conclude', label: 'conclude', note: 'closes the thinking and lets the model answer' },
] as const

/**
 * The gate message the form shows while the speculation fields are greyed
 * out. It names the fix (pick a backend) and the backends that unlock the
 * fields, so a first-time user knows the next click, not just the constraint.
 */
export const SPEC_GATE_MESSAGE = 'Pick a speculation backend first (mtp, dflash, or dflash2)'

/**
 * The gate message the form shows while the dflash2-only fields are greyed
 * out. It names the fix (pick dflash2) and the reason, so a first-time user
 * knows the next click, not just the constraint.
 */
export const DFLASH2_GATE_MESSAGE =
  'Pick the dflash2 speculation backend first; the DFlash2 drafter loads with dflash2'

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
  file: string
  files?: string[]
  repo: string
  modelId: string
}

/**
 * The Infernix model artifacts, keyed by the config model key. The 27B
 * NVIDIA NVFP4 entry is the default the DEFAULT_MODELS list names; an id no
 * entry names falls back to it, so a bare config always renders a plan. The
 * Flash-Next entry is the recommended Dense8 conversion: its download pulls
 * the whole repo, which carries the FP8 n-gram volume beside the shards, so
 * the `--ngram-volume` flag points at a file the same download left on disk.
 */
export const INFERNIX_MODEL_ARTIFACTS: Record<string, InfernixModelArtifact> = {
  'qwen3-27b': {
    file: 'qwen3_8_27b_nvfp4-nvidia.ninfer',
    repo: 'Wallawalla47/Qwen3.8-27B-NVIDIA-NVFP4-NInferV3',
    modelId: 'Qwen3.8-27B',
  },
  'qwen3-27b-uncensored': {
    file: 'qwen3_8_27b_nvfp4-uncensored.ninfer',
    repo: 'Wallawalla47/Qwen3.8-27B-Uncensored-NVFP4-NInferV3',
    modelId: 'Qwen3.8-27B',
  },
  'qwen38-flash-next': {
    file: 'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix',
    files: [
      'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix',
      'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00002-of-00003.infernix',
      'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00003-of-00003.infernix',
    ],
    repo: 'Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix',
    modelId: 'Qwen3.8-Flash-Next',
  },
  'qwen38-flash-next-dflash2': {
    file: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
    repo: 'Wallawalla47/Qwen3.8-Flash-Next-DFlash2-Infernix',
    modelId: 'Qwen3.8-Flash-Next-DFlash2',
  },
  'qwen36-35b': {
    file: 'qwen3_6_35b_a3b.ninfer',
    repo: 'neroued/Qwen3.6-35B-A3B-NInfer',
    modelId: 'Qwen3.6-35B-A3B',
  },
}

/**
 * The Infernix `ParameterSpec` surface, in form order. The `group` field is
 * the form section; specs without a group render under `General`. The
 * Infernix-only fields (ngramVolume, draftModel, the n-gram proposal set,
 * the expert memory tiers, the quality routes) appear only on this surface,
 * so the form shows them only while the Infernix engine is selected.
 */
export const INFERNIX_PARAMETERS: readonly ParameterSpec[] = [
  {
    key: 'port',
    label: 'Port',
    description:
      'The loopback port the engine serves its OpenAI endpoint and health check on. The registrar publishes it as the model base URL.',
    // The port is a typed number, not a range strip: a 1..65535 drag slider is
    // noise, so `slider: false` renders the plain number entry only.
    form: { kind: 'number', min: 1, max: 65535, step: 1, slider: false },
    // 8080 is the port the infernix-serve CLI binds by default, so the form
    // seeds the value the adapter's own fallback uses when a config names no
    // port.
    defaultValue: 8080,
    group: 'Engine',
    // The port contributes no flag of its own: renderLaunch spells the local
    // `--port` from this value, and the health URL derives from it too.
  },
  {
    key: 'kvDtype',
    label: 'KV cache format',
    description:
      'Quantizes the KV cache. Smaller formats fit a longer context in the same VRAM at a small quality cost.',
    form: { kind: 'enum', options: [...INFERNIX_KV_DTYPE_OPTIONS] },
    defaultValue: 'int8',
    group: 'Memory',
    hardwareConstraint: (value, hw: HardwareProfile) => {
      // nvfp4 KV runs on SM 89 (Ada) and newer; a 30-series card (sm86) cannot
      // serve it, so the warning names the fix before the engine starts.
      if (value === 'nvfp4' && hw.gpu && hw.gpu.sm < 89) {
        return {
          ok: false,
          severity: 'error',
          message: `nvfp4 KV needs SM 89 or newer; this card reports SM ${hw.gpu.sm}. Pick k8v4 or vq2.`,
        }
      }
      return { ok: true }
    },
    toArgv: (value) => ['--kv-dtype', String(value)],
  },
  {
    key: 'maxContext',
    label: 'Max context',
    description:
      'The longest conversation the engine accepts. Raising it reserves more VRAM for the KV cache.',
    form: { kind: 'number', min: 256, max: 262144, step: 256, unit: 'tokens' },
    defaultValue: 32768,
    group: 'Memory',
    toArgv: (value) => ['--max-context', String(value)],
  },
  {
    key: 'kvCapacity',
    label: 'KV capacity',
    description:
      'The shared KV pool across concurrent requests. Leave unset to let the engine maximize the pool from the remaining GPU memory.',
    form: {
      kind: 'number',
      min: 256,
      step: 256,
      unit: 'tokens',
      // The range strip caps at the live max-context value (the pool cannot
      // outgrow the context it serves), re-priced on every form render so a
      // max-context edit moves the cap without touching the current value.
      // The number entry stays uncapped, so a typed value is never hard-limited.
      sliderMax: (_hw, config) => (typeof config.maxContext === 'number' ? config.maxContext : 0),
    },
    group: 'Memory',
    toArgv: (value) => ['--kv-capacity', String(value)],
  },
  {
    key: 'hostContextMib',
    label: 'Host context MiB',
    description:
      'Pinned host RAM for the hybrid prefix cache: the slab pool the KV blocks and state snapshots share. Retains inactive conversations when device memory is under pressure.',
    form: {
      kind: 'number',
      min: 0,
      step: 1024,
      unit: 'MiB',
      // The range strip caps at half the host RAM (the pool cannot outgrow the
      // machine it pins), while the number entry stays uncapped so a typed
      // value is never hard-limited by the slider.
      sliderMax: (hw) => Math.max(0, Math.floor((hw.hostRamGiB ?? 0) * 0.5 * 1024)),
    },
    group: 'Memory',
    // 8192 MiB is the engine default the form seeds; a value of 0 keeps the
    // cache on the device only, which the engine still accepts.
    defaultValue: 8192,
    toArgv: (value) => ['--host-context-mib', String(value)],
  },
  {
    key: 'mediaLiveMib',
    label: 'Media live MiB',
    description:
      'Pinned host RAM reserved for live media (vision) decode. Retains the in-flight image and video buffers outside the GPU workspace.',
    form: { kind: 'number', min: 0, step: 1024, unit: 'MiB' },
    group: 'Memory',
    toArgv: (value) => ['--media-live-mib', String(value)],
  },
  {
    key: 'ramHeadroomMib',
    label: 'RAM headroom MiB',
    description:
      'Host RAM the pinned weights and caches leave free for the rest of the machine. The startup refuses a pin that would take it.',
    form: { kind: 'number', min: 0, step: 256, unit: 'MiB' },
    defaultValue: 2048,
    group: 'Memory',
    toArgv: (value) => ['--ram-headroom-mib', String(value)],
  },
  {
    key: 'vramHeadroomMib',
    label: 'VRAM headroom MiB',
    description:
      'VRAM the startup sizing leaves free for the display and other programs. Leave unset for the engine automatic headroom.',
    form: { kind: 'number', min: 0, step: 256, unit: 'MiB' },
    group: 'Memory',
    // The engine defaults to auto, so a bare value spells no flag.
    toArgv: (value) => ['--vram-headroom-mib', String(value)],
  },
  {
    key: 'expertRamMib',
    label: 'Expert RAM MiB',
    description:
      'Host RAM for the routed experts of offloaded models. Less than the full set keeps that many in RAM and reads the rest from the artifact on an SSD tier.',
    form: { kind: 'number', min: 0, step: 1024, unit: 'MiB' },
    group: 'Memory',
    // The engine defaults to auto (what the RAM ledger leaves), so a bare
    // value spells no flag.
    toArgv: (value) => ['--expert-ram-mib', String(value)],
  },
  {
    key: 'expertPinMib',
    label: 'Expert pin MiB',
    description:
      'How much of the expert RAM the GPU page-locks. The rest stays unpinned and the CPU serves it, which the page-locking limit on the OS bounds.',
    form: { kind: 'number', min: 0, step: 1024, unit: 'MiB' },
    group: 'Memory',
    // The engine defaults to auto (what the OS lets the GPU page-lock), so a
    // bare value spells no flag.
    toArgv: (value) => ['--expert-pin-mib', String(value)],
  },
  {
    key: 'ngramResidency',
    label: 'N-gram residency',
    description:
      'Chooses where the PLE n-gram table of Qwen3.8-Flash-Next lives: pinned RAM, the volume, or the engine automatic rule.',
    form: { kind: 'enum', options: [...INFERNIX_NGRAM_RESIDENCY_OPTIONS] },
    defaultValue: 'auto',
    group: 'Memory',
    // auto is the engine default, so the bare value spells no flag.
    toArgv: (value) => (value === 'auto' ? [] : ['--ngram-residency', String(value)]),
  },
  {
    key: 'maxConcurrency',
    label: 'Max concurrency',
    description:
      'How many requests decode at once. More lanes share the KV pool and cut per-request throughput.',
    form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'lanes' },
    defaultValue: 1,
    group: 'Concurrency',
    toArgv: (value) => ['--max-concurrency', String(value)],
  },
  {
    key: 'maxPendingRequests',
    label: 'Max pending requests',
    description:
      'How many extra requests may wait for an admission slot. Raises the queue for bursty agent traffic at the cost of longer waits.',
    form: { kind: 'number', min: 0, step: 1, unit: 'requests' },
    group: 'Concurrency',
    toArgv: (value) => ['--max-pending-requests', String(value)],
  },
  {
    key: 'spec',
    label: 'Speculation backend',
    description:
      'The speculative-decoding backend. Speeds decode when drafts are accepted; adds draft weights and CUDA graphs to resident memory.',
    form: { kind: 'enum', options: [...INFERNIX_SPEC_OPTIONS] },
    defaultValue: 'none',
    group: 'Speculation',
    toArgv: (value) => (value === 'none' ? [] : ['--spec', String(value)]),
  },
  {
    key: 'draftTokens',
    label: 'Draft tokens',
    description:
      'How many draft tokens a speculative round verifies. More drafts speed decode but cost more per round; auto verifies the count the drafter probabilities make fastest.',
    form: { kind: 'number', min: 1, max: 15, step: 1, unit: 'tokens' },
    defaultValue: 3,
    group: 'Speculation',
    requires: (config: Config) =>
      config.spec && config.spec !== 'none' ? null : SPEC_GATE_MESSAGE,
    toArgv: (value) => ['--draft-tokens', String(value)],
  },
  {
    key: 'lmHeadDraft',
    label: 'LM-head draft',
    description:
      'Drafts from the small proposal head instead of the full output head, cutting the per-draft projection cost.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Speculation',
    requires: (config: Config) =>
      config.spec && config.spec !== 'none' ? null : SPEC_GATE_MESSAGE,
    toArgv: (value) => (value === true ? ['--lm-head-draft'] : []),
  },
  {
    key: 'draftModel',
    label: 'Draft model',
    description:
      'The DFlash2 drafter companion artifact for Qwen3.8-Flash-Next. Downloads separately from the model, and the engine loads it beside the main artifact.',
    form: { kind: 'path' },
    group: 'Speculation',
    // The drafter only loads with the dflash2 backend, so the field stays
    // greyed out until the user picks it.
    requires: (config: Config) =>
      config.spec === 'dflash2' ? null : DFLASH2_GATE_MESSAGE,
    toArgv: (value) => (value ? ['--draft-model', String(value)] : []),
  },
  {
    key: 'ngramDraftTokens',
    label: 'N-gram draft tokens',
    description:
      'Verified n-gram copy proposals per round beside the spec drafter. Speeds decode on repetitive text; 0 disables the proposals.',
    form: { kind: 'number', min: 0, max: 63, step: 1, unit: 'proposals' },
    group: 'Speculation',
    toArgv: (value) => (value === 0 ? [] : ['--ngram-draft-tokens', String(value)]),
  },
  {
    key: 'ngramMinMatch',
    label: 'N-gram min match',
    description:
      'The minimum matched tokens an n-gram copy proposal must reach. Raises it to verify longer copies at a lower proposal rate.',
    form: { kind: 'number', min: 4, max: 64, step: 1, unit: 'tokens' },
    defaultValue: 12,
    group: 'Speculation',
    // The minimum match only prices a proposal the user enabled, so the
    // field stays greyed out while n-gram drafting is off.
    requires: (config: Config) =>
      typeof config.ngramDraftTokens === 'number' && config.ngramDraftTokens > 0
        ? null
        : 'Enable n-gram copy proposals first (n-gram draft tokens above 0)',
    toArgv: (value) => ['--ngram-min-match', String(value)],
  },
  {
    key: 'ngramVolume',
    label: 'N-gram volume',
    description:
      'The PLE n-gram table file for Qwen3.8-Flash-Next, kept apart from the model shards and read from an NVMe drive. The recommended FP8 table downloads with the Dense8 model repo.',
    form: { kind: 'path' },
    group: 'Artifacts',
    toArgv: (value) => (value ? ['--ngram-volume', String(value)] : []),
  },
  {
    key: 'expertState',
    label: 'Expert state',
    description:
      'The saved expert-cache state file. The engine seeds the VRAM expert cache from it at startup and rewrites it on stop, so warm experts survive a restart.',
    form: { kind: 'path' },
    group: 'Artifacts',
    // The engine defaults to the artifact-named state file, so a bare value
    // spells no flag.
    toArgv: (value) => (value ? ['--expert-state', String(value)] : []),
  },
  {
    key: 'prefixCacheFile',
    label: 'Prefix cache file',
    description:
      'The file the hybrid prefix cache saves to on stop and reloads on start, so cached KV blocks survive a restart.',
    form: { kind: 'path' },
    group: 'Artifacts',
    toArgv: (value) => (value ? ['--prefix-cache-file', String(value)] : []),
  },
  {
    key: 'prefillChunk',
    label: 'Prefill chunk',
    description:
      'The prompt-chunk size for prefill, in multiples of 128. The engine rounds it to whole attention waves; leave unset for the automatic size.',
    form: {
      kind: 'number',
      min: 128,
      step: 128,
      unit: 'tokens',
      // The range strip caps at the live max-context value (a chunk cannot
      // outgrow the context it serves), re-priced on every form render. The
      // number entry stays uncapped, so a typed value is never hard-limited.
      sliderMax: (_hw, config) => (typeof config.maxContext === 'number' ? config.maxContext : 0),
    },
    group: 'Engine',
    toArgv: (value) => ['--prefill-chunk', String(value)],
  },
  {
    key: 'vision',
    label: 'Vision input',
    description:
      'Accepts image and video input. Adds the vision tower and its encode workspace to resident memory.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Engine',
    toArgv: (value) => (value === true ? ['--vision'] : []),
  },
  {
    key: 'noCudaGraph',
    label: 'Disable CUDA graphs',
    description:
      'Turns off CUDA Graph decode. Costs decode speed, which helps a debug build that cannot instantiate graphs.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Engine',
    toArgv: (value) => (value === true ? ['--no-cuda-graph'] : []),
  },
  {
    key: 'reproducible',
    label: 'Reproducible route',
    description:
      'Runs the bit-exact reproducible route: request-invariant output from release to release, at the cost of the fast paths.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Engine',
    toArgv: (value) => (value === true ? ['--reproducible'] : []),
  },
  {
    key: 'lossless',
    label: 'Lossless route',
    description:
      'Computes the model forward pass exactly, rounded once to its dtype. The output depends on the request and artifact alone, at the slowest speed.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Engine',
    toArgv: (value) => (value === true ? ['--lossless'] : []),
  },
  {
    key: 'ropeYarnFactor',
    label: 'YaRN factor',
    description:
      'Extends the context ceiling by the YaRN scaling factor, from the native limit up to 4x. Long-context extrapolation, not a quality guarantee.',
    form: { kind: 'number', min: 1, max: 4, step: 0.05 },
    defaultValue: 1,
    group: 'Engine',
    // 1 leaves the native RoPE unchanged, so the bare value spells no flag.
    toArgv: (value) => (value === 1 ? [] : ['--rope-yarn-factor', String(value)]),
  },
  {
    key: 'chatTemplate',
    label: 'Chat template',
    description:
      'Overrides the artifact built-in Jinja chat template. Pick a preset from the dropdown, or choose Custom and type a local path or HF repo reference. Changes take effect after a restart.',
    form: { kind: 'combo', options: [...CHAT_TEMPLATE_OPTIONS] },
    group: 'Engine',
    toArgv: (value) => (value ? ['--chat-template', String(value)] : []),
  },
  {
    key: 'temperature',
    label: 'Temperature',
    description:
      'Sampling randomness. 0 decodes deterministically; higher values draw from a wider token distribution.',
    form: { kind: 'number', min: 0, max: 2, step: 0.05 },
    defaultValue: 0.9,
    group: 'Sampling',
    toArgv: (value) => ['--temperature', String(value)],
  },
  {
    key: 'minP',
    label: 'Min-p',
    description:
      'Drops tokens whose probability falls under this fraction of the top token, trimming the sampling tail.',
    form: { kind: 'number', min: 0, max: 1, step: 0.01 },
    defaultValue: 0.05,
    group: 'Sampling',
    toArgv: (value) => ['--min-p', String(value)],
  },
  {
    key: 'defaultMaxTokens',
    label: 'Default max tokens',
    description:
      'Caps the response length when a request names no max. Raises it for long answers; the engine still honours a per-request cap.',
    form: {
      kind: 'number',
      // A response under 1024 tokens is too short to be useful, so the floor
      // is 1024, not 1.
      min: 1024,
      step: 1,
      unit: 'tokens',
      // The range strip caps at 12.5% of the live max-context value (the
      // default response cannot outgrow the quarter of context it is priced
      // against), re-priced on every form render. The number entry stays
      // uncapped, so a typed value is never hard-limited by the slider.
      sliderMax: (_hw, config) => {
        const ctx = typeof config.maxContext === 'number' ? config.maxContext : 0
        return Math.max(0, Math.floor(ctx * 0.125))
      },
    },
    group: 'Sampling',
    toArgv: (value) => ['--default-max-tokens', String(value)],
  },
  {
    key: 'defaultThinkingBudget',
    label: 'Default thinking budget',
    description:
      'Reserves reasoning tokens for a thinking model when a request names no budget. Higher budgets spend more time reasoning per turn.',
    form: { kind: 'number', min: 0, step: 1, unit: 'tokens' },
    group: 'Sampling',
    toArgv: (value) => ['--default-thinking-budget', String(value)],
  },
  {
    key: 'preserveThinking',
    label: 'Preserve thinking',
    description:
      'Keeps the reasoning trace in the context across turns instead of dropping it, so a multi-turn conversation builds on its own prior reasoning.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Sampling',
    toArgv: (value) => (value === true ? ['--preserve-thinking'] : []),
  },
  {
    key: 'tolerantToolCalls',
    label: 'Tolerant tool calls',
    description:
      'Recovers tool calls the model truncates or malforms: a suffix after a complete call, a cut closing tag, or a call stranded in unclosed thinking.',
    form: { kind: 'boolean' },
    defaultValue: false,
    group: 'Sampling',
    toArgv: (value) => (value === true ? ['--tolerant-tool-calls'] : []),
  },
  {
    key: 'reasoningLoop',
    label: 'Reasoning loop guard',
    description:
      'Ends the reply, or closes the thinking, when the open thinking keeps repeating whole passages. Guards long thinking runs that stall.',
    form: { kind: 'enum', options: [...INFERNIX_REASONING_LOOP_OPTIONS] },
    defaultValue: 'off',
    group: 'Sampling',
    // off is the engine default, so the bare value spells no flag.
    toArgv: (value) => (value === 'off' ? [] : ['--reasoning-loop', String(value)]),
  },
]

/**
 * The Infernix model key a config carries: the string model value, falling
 * back to the 27B artifact key so a bare config always renders a plan. A
 * value that names a local artifact file (a directory-scanned model, a
 * `.ninfer` or `.infernix` name) passes through unchanged.
 */
export function infernixModelKey(config: Config): string {
  return typeof config.model === 'string' && config.model !== '' ? config.model : 'qwen3-27b'
}

/**
 * infernixArtifactFor resolves the artifact a model key deploys. A key that
 * names a local artifact file passes through the artifact map's 27B entry
 * for the model id, and an id no entry names falls back to the 27B entry, so
 * a bare config always renders a plan.
 */
export function infernixArtifactFor(modelKey: string): InfernixModelArtifact {
  if (modelKey.endsWith('.ninfer') || modelKey.endsWith('.infernix')) {
    return INFERNIX_MODEL_ARTIFACTS['qwen3-27b']!
  }
  const artifact = INFERNIX_MODEL_ARTIFACTS[modelKey]
  return artifact ?? INFERNIX_MODEL_ARTIFACTS['qwen3-27b']!
}
