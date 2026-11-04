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

import type {
  ComboOption,
  Config,
  EnumOption,
  HardwareProfile,
  ParameterSpec,
} from 'dsh-plugin-local-infer/core'

/**
 * The Hugging Face repo and file the deploy step downloads into the model
 * directory: the single `.basalt` artifact the engine serves (the weights,
 * tokenizer, chat template, drafter, vision projector, and default
 * sampling all come from it). The constants live in this leaf module so
 * both the adapter and the default model list import them without a
 * circular edge.
 */
export const BASALT_MODEL_REPO = 'jesdga/Qwen3.8-Flash-Next-Basalt'
export const BASALT_MODEL_FILE = 'Qwen3.8-FN-NVFP4-DQ6_K.basalt'

/**
 * The loopback port the basalt serve CLI binds by default, so a config that
 * names no port launches on it. The port spec's defaultValue and the adapter's
 * port fallback share this one constant.
 */
export const BASALT_DEFAULT_PORT = 8080

/**
 * The model id of the single default registry entry: the Qwen3.8-Flash-Next
 * `.basalt` artifact the engine serves. The default model list and the
 * adapter's plan modelId stamp share this one constant, so a bare config
 * names the same model the card's Model dropdown offers.
 */
export const BASALT_DEFAULT_MODEL_ID = 'qwen38-flash-next'

/**
 * The KV cache storage formats Basalt serves, in the order the form
 * dropdown lists them. `note` carries the tradeoff text the dropdown shows
 * beside each choice.
 */
export const BASALT_KV_OPTIONS: readonly EnumOption[] = [
  { value: 'fp16', label: 'fp16', note: 'full precision; the widest KV pool, the default' },
  { value: 'int8', label: 'int8', note: 'half the bytes of fp16; the everyday long-context choice' },
  {
    value: 'q4_0',
    label: 'q4_0',
    note: '4-bit after a Hadamard rotation, half of int8 again, slightly lower precision',
  },
  {
    value: 'k8v4',
    label: 'k8v4',
    note: 'K in int8, V in rotated 4-bit; 816 B per cell against int8 at 1056',
  },
] as const

/**
 * The image-input modes. `off` reads no pictures; `dynamic` borrows
 * expert-cache slots inside the engine only while it reads an image; `cpu`
 * runs the encoder on the CPU (no VRAM, slow). A GPU number pins the
 * encoder sidecar to that card; the combo control offers the three named
 * modes and accepts a free-text GPU number.
 */
export const BASALT_VISION_OPTIONS: readonly ComboOption[] = [
  { value: 'off', label: 'off', note: 'no image input; the default', source: 'engine' },
  {
    value: 'dynamic',
    label: 'dynamic',
    note: 'inside the engine; borrows expert-cache slots only while it reads an image',
    source: 'engine',
  },
  {
    value: 'cpu',
    label: 'cpu',
    note: 'the encoder runs on the CPU; no VRAM, slow',
    source: 'engine',
  },
] as const

/**
 * The expert-cache sizes. `auto` takes as many expert blobs as fit in the
 * VRAM left after the weights, the session and the reserve; a free-text
 * count pins the number of blobs. The combo control offers `auto` and
 * accepts a free-text count.
 */
export const BASALT_EXPERT_CACHE_OPTIONS: readonly ComboOption[] = [
  {
    value: 'auto',
    label: 'auto',
    note: 'as many expert blobs as fit after the weights and the reserve; the default',
    source: 'engine',
  },
] as const

/**
 * The Basalt `ParameterSpec` surface, in form order. Every spec carries a
 * `config` deploy target: the value nests under the `server` or `engine`
 * block of the `basalt_config.json` the deploy step writes. The multi-word
 * engine keys name their flag spelling in `deploy.key`; the config parser
 * lowercases the key and turns `_` into `-`, so the dash form is the one it
 * matches.
 */
export const BASALT_PARAMETERS: readonly ParameterSpec[] = [
  {
    key: 'port',
    label: 'Port',
    description:
      'The loopback port the engine serves its OpenAI endpoint and health check on. The registrar publishes it as the model base URL.',
    // The port is a typed number, not a range strip: a 1..65535 drag slider is
    // noise, so `slider: false` renders the plain number entry only.
    form: { kind: 'number', min: 1, max: 65535, step: 1, slider: false },
    // The port the basalt serve CLI binds by default, so the form seeds the
    // value the adapter's own fallback uses when a config names no port.
    defaultValue: BASALT_DEFAULT_PORT,
    group: 'Engine',
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'host',
    label: 'Host',
    description:
      'The address to listen on. 127.0.0.1 serves this machine only; 0.0.0.0 also serves the network, which needs an API key.',
    form: { kind: 'text', placeholder: '127.0.0.1' },
    defaultValue: '127.0.0.1',
    group: 'Engine',
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'gpu',
    label: 'GPU',
    description:
      'Card numbers the model shares, e.g. 0 or 0,1, or auto to take every Blackwell card. The first is the main card.',
    form: { kind: 'text', placeholder: '0' },
    group: 'Engine',
    // Basalt is Blackwell-only: the engine is compiled for sm_120 and its
    // NVFP4 expert kernels need it. A card that reports a lower SM number,
    // or no card at all, cannot run it, so the error names the fix before
    // the engine starts.
    hardwareConstraint: (_value, hw: HardwareProfile) => {
      const sm = hw.gpu?.sm ?? 0
      if (sm < 120) {
        return {
          ok: false,
          severity: 'error',
          message: `Basalt needs an NVIDIA Blackwell GPU (SM 120); this machine reports SM ${sm}.`,
        }
      }
      return { ok: true }
    },
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'parallel',
    label: 'Parallel requests',
    description:
      'How many requests decode at once, 1 to 8. More lanes share the model and cut per-request throughput; the max context is split across the lanes.',
    form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'lanes' },
    defaultValue: 1,
    group: 'Concurrency',
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'vision',
    label: 'Vision input',
    description:
      'Whether the model reads pictures. off reads none; dynamic borrows expert-cache slots only while it reads an image; cpu runs the encoder on the CPU; a GPU number pins the encoder to that card.',
    form: { kind: 'combo', options: [...BASALT_VISION_OPTIONS] },
    defaultValue: 'off',
    group: 'Engine',
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'model',
    label: 'Model path',
    description:
      'The .basalt model file: the weights, tokenizer, chat template, drafter, vision projector and default sampling all come from it.',
    form: { kind: 'path' },
    group: 'Artifacts',
    deploy: { target: 'config', format: 'json', block: 'server' },
  },
  {
    key: 'kv',
    label: 'KV cache format',
    description:
      'Quantizes the KV cache. Smaller formats fit a longer context in the same VRAM at a small quality cost.',
    form: { kind: 'enum', options: [...BASALT_KV_OPTIONS] },
    defaultValue: 'fp16',
    group: 'Memory',
    deploy: { target: 'config', format: 'json', block: 'engine' },
  },
  {
    key: 'maxContext',
    label: 'Max context',
    description:
      'The longest conversation the engine accepts. Raising it reserves more VRAM for the KV cache; with parallel it is shared across the lanes.',
    form: { kind: 'number', min: 256, max: 262144, step: 256, unit: 'tokens' },
    defaultValue: 4096,
    group: 'Memory',
    deploy: { target: 'config', format: 'json', block: 'engine', key: 'max-context' },
  },
  {
    key: 'expertCache',
    label: 'Expert cache',
    description:
      'How many expert blobs stay in VRAM. auto takes as many as fit after the weights and the reserve; a count pins the number.',
    form: { kind: 'combo', options: [...BASALT_EXPERT_CACHE_OPTIONS] },
    defaultValue: 'auto',
    group: 'Memory',
    deploy: { target: 'config', format: 'json', block: 'engine', key: 'expert-cache' },
  },
  {
    key: 'prefill',
    label: 'Prefill chunk',
    description:
      'The prompt is read in batched chunks of this many tokens. auto takes the largest chunk the expert cache can lend; a number pins the chunk size.',
    form: { kind: 'text', placeholder: 'auto' },
    defaultValue: 'auto',
    group: 'Engine',
    deploy: { target: 'config', format: 'json', block: 'engine' },
  },
  {
    key: 'residentExperts',
    label: 'Resident experts',
    description:
      'Keeps the experts the GPU does not hold in page-locked RAM, so none is read from the file again. Off falls back to a plain file mapping.',
    form: { kind: 'boolean' },
    defaultValue: true,
    group: 'Memory',
    deploy: { target: 'config', format: 'json', block: 'engine', key: 'resident-experts' },
  },
  {
    key: 'spec',
    label: 'Speculation',
    description:
      'The drafter proposes tokens and the model verifies windows of at most this many. 0 or 1 turns speculation off; the default is 8 with a drafter.',
    form: { kind: 'number', min: 0, max: 16, step: 1, unit: 'tokens' },
    defaultValue: 8,
    group: 'Engine',
    deploy: { target: 'config', format: 'json', block: 'engine' },
  },
]

/**
 * The Basalt model key a config carries: the string `.basalt` model path,
 * falling back to an empty string so a bare config renders a plan the
 * adapter fills in with the downloaded model file. A value that names a
 * local artifact path passes through unchanged.
 */
export function basaltModelKey(config: Config): string {
  return typeof config.model === 'string' ? config.model : ''
}
