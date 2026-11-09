/**
 * Basalt parameter surface. The declarative `ParameterSpec` data for the
 * Basalt engine (https://github.com/jesdga95/basalt), sourced from the
 * repository's `docs/configuration/index.md`. Basalt is a C++/CUDA engine
 * for the Qwen3.8-Flash-Next and DeepSeek-V4.1-Flash MoE models,
 * Blackwell-only (sm_120). Every setting lands in a v2
 * `basalt_config.json` file the deploy step writes, so each spec carries a
 * `config` deploy target naming where the value nests: the shared `server`
 * options, the per-model settings of the single `models[]` entry, or the
 * shared `engine` flags; the `BasaltAdapter` renders the file with
 * `configFileFromSpecs` and passes it to `basalt serve --config`.
 *
 * The data is the surface; the adapter composes it into a `LaunchPlan`.
 * Adding a setting here is a data edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basalt
 */
import { basename } from 'node:path';
/**
 * The Hugging Face repo and file of the bundled Qwen `.basalt` artifact
 * (the weights, tokenizer, chat template, drafter, vision projector, and
 * default sampling all come from it), the one a bare config serves. The
 * constants live in this leaf module so both the adapter and the default
 * model list import them without a circular edge.
 */
export const BASALT_MODEL_REPO = 'jesdga/Qwen3.8-Flash-Next-Basalt';
export const BASALT_MODEL_FILE = 'Qwen3.8-FN-NVFP4-DQ6_K.basalt';
/**
 * The Hugging Face repo and file of the second `.basalt` artifact the
 * engine serves: the DeepSeek-V4.1-Flash UD-IQ1_M pack the v0.3.0 release
 * notes name. The registry key and the served API id ride beside them, so
 * the default model list, the VRAM and preset rows, the adapter's per-
 * artifact download resolution, and the entry's alias stamp all name the
 * same pack from one place.
 */
export const BASALT_DEEPSEEK_MODEL_REPO = 'jesdga/DeepSeek-V4.1-Flash-1017-Basalt';
export const BASALT_DEEPSEEK_MODEL_FILE = 'DeepSeek-V4.1-Flash-1017-UD-IQ1_M.basalt';
/**
 * The `basalt_config.json` format version the adapter's render envelope
 * stamps under the top-level `version` key. v0.3.0 refuses a file without
 * the stamp as a v1 config; the adapter's envelope reads this constant, so
 * the version lives beside the surface that re-blocked for it.
 */
export const BASALT_CONFIG_VERSION = 2;
/**
 * The loopback port the basalt serve CLI binds by default, so a config that
 * names no port launches on it. The port spec's defaultValue and the adapter's
 * port fallback share this one constant.
 */
export const BASALT_DEFAULT_PORT = 8080;
/**
 * The model id of the default registry entry a bare config names: the
 * Qwen3.8-Flash-Next `.basalt` artifact the engine serves. The default
 * model list, the built-in preset key, the Basalt VramModel id, and the
 * adapter's plan modelId stamp all share this one constant, so every
 * model-id keyed read of the engine names the same model the card's Model
 * dropdown offers first.
 */
export const BASALT_DEFAULT_MODEL_ID = 'qwen38-flash-next';
/**
 * The registry key and served API id of the second default entry, the
 * DeepSeek-V4.1-Flash UD-IQ1_M pack: `BASALT_DEEPSEEK_MODEL_ID` keys the
 * default model list, the VRAM row, and the preset row, while
 * `BASALT_DEEPSEEK_SERVED_MODEL_ID` is the name the adapter stamps as the
 * config entry's `alias` and the registrar publishes (basaltServedName).
 * The alias pins the name on `/v1/models` because the pack's stored
 * `meta.name` is not known to the plugin.
 */
export const BASALT_DEEPSEEK_MODEL_ID = 'deepseek-v41-flash';
export const BASALT_DEEPSEEK_SERVED_MODEL_ID = 'DeepSeek-V4.1-Flash';
/**
 * The model id the serve server reports the bundled Qwen artifact under:
 * the `meta.name` stored inside the `.basalt` artifact file. The adapter
 * stamps it as the config entry's `alias` and the registrar publishes it
 * (basaltServedName), so `/v1/models` always lists this name and the
 * registry key and the file path are never advertised.
 */
export const BASALT_SERVED_MODEL_ID = 'Qwen3.8-Flash-Next NVIDIA-NVFP4';
/**
 * The KV cache storage formats Basalt serves, in the order the form
 * dropdown lists them. `note` carries the tradeoff text the dropdown shows
 * beside each choice.
 */
export const BASALT_KV_OPTIONS = [
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
];
/**
 * The image-input modes. `off` reads no pictures; `dynamic` borrows
 * expert-cache slots inside the engine only while it reads an image; `cpu`
 * runs the encoder on the CPU (no VRAM, slow). A GPU number pins the
 * encoder sidecar to that card; the combo control offers the three named
 * modes and accepts a free-text GPU number.
 */
export const BASALT_VISION_OPTIONS = [
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
];
/**
 * The expert-cache sizes. `auto` takes as many expert blobs as fit in the
 * VRAM left after the weights, the session and the reserve; a free-text
 * count pins the number of blobs. The combo control offers `auto` and
 * accepts a free-text count.
 */
export const BASALT_EXPERT_CACHE_OPTIONS = [
    {
        value: 'auto',
        label: 'auto',
        note: 'as many expert blobs as fit after the weights and the reserve; the default',
        source: 'engine',
    },
];
/**
 * The Basalt `ParameterSpec` surface, in form order. Every spec carries a
 * `config` deploy target naming its v2 `basalt_config.json` placement:
 * shared server options under `server`, per-model settings merged into the
 * single `models[]` entry, and shared engine flags under `engine`. The
 * multi-word keys name their flag spelling in `deploy.key`; the config
 * parser lowercases the key and turns `_` into `-`, so the dash form is the
 * one it matches.
 */
export const BASALT_PARAMETERS = [
    {
        key: 'port',
        label: 'Port',
        description: 'The loopback port the engine serves its OpenAI endpoint and health check on. The registrar publishes it as the model base URL.',
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
        description: 'The address to listen on. 127.0.0.1 serves this machine only; 0.0.0.0 also serves the network, which needs an API key.',
        form: { kind: 'text', placeholder: '127.0.0.1' },
        defaultValue: '127.0.0.1',
        group: 'Engine',
        deploy: { target: 'config', format: 'json', block: 'server' },
    },
    {
        key: 'gpu',
        label: 'GPU',
        description: 'Card numbers the model shares, e.g. 0 or 0,1, or auto to take every Blackwell card. The first is the main card.',
        form: { kind: 'text', placeholder: '0' },
        group: 'Engine',
        // Basalt is Blackwell-only: the engine is compiled for sm_120 and its
        // NVFP4 expert kernels need it. A card that reports a lower SM number,
        // or no card at all, cannot run it, so the error names the fix before
        // the engine starts.
        hardwareConstraint: (_value, hw) => {
            const sm = hw.gpu?.sm ?? 0;
            if (sm < 120) {
                return {
                    ok: false,
                    severity: 'error',
                    message: `Basalt needs an NVIDIA Blackwell GPU (SM 120); this machine reports SM ${sm}.`,
                };
            }
            return { ok: true };
        },
        deploy: { target: 'config', format: 'json', block: 'models[]' },
    },
    {
        key: 'vram-reserve-mib',
        label: 'VRAM Reserved',
        description: 'How much VRAM (in MiB) to reserve for code or system functions. More VRAM gives room for other apps to run.',
        form: { kind: 'number', min: 256, max: 8000, step: 1, unit: 'MiB' },
        defaultValue: 700,
        group: 'Engine',
        deploy: { target: 'config', format: 'json', block: 'engine' },
    },
    {
        key: 'parallel',
        label: 'Parallel requests',
        description: 'How many requests decode at once, 1 to 8. More lanes share the model and cut per-request throughput; the max context is split across the lanes.',
        form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'lanes' },
        defaultValue: 1,
        group: 'Concurrency',
        deploy: { target: 'config', format: 'json', block: 'models[]' },
    },
    {
        key: 'vision',
        label: 'Vision input',
        description: 'Whether the model reads pictures. off reads none; dynamic borrows expert-cache slots only while it reads an image; cpu runs the encoder on the CPU; a GPU number pins the encoder to that card.',
        form: { kind: 'combo', options: [...BASALT_VISION_OPTIONS] },
        defaultValue: 'off',
        group: 'Engine',
        deploy: { target: 'config', format: 'json', block: 'models[]' },
    },
    {
        key: 'model',
        label: 'Model path',
        description: 'The .basalt model file: the weights, tokenizer, chat template, drafter, vision projector and default sampling all come from it.',
        form: { kind: 'path' },
        group: 'Artifacts',
        deploy: { target: 'config', format: 'json', block: 'models[]' },
    },
    {
        key: 'kv',
        label: 'KV cache format',
        description: 'Quantizes the KV cache. Smaller formats fit a longer context in the same VRAM at a small quality cost.',
        form: { kind: 'enum', options: [...BASALT_KV_OPTIONS] },
        defaultValue: 'fp16',
        group: 'Memory',
        // kv stays in the top-level engine block, unlike the upstream v1-to-v2
        // migration's default. A flag the model lacks stops the start in a
        // model entry but is left out for that model in the engine block
        // (upstream docs/configuration/models.md), so one surface serves both
        // Flash-Next (takes kv) and DeepSeek-V4.1-Flash (no KV format choice).
        deploy: { target: 'config', format: 'json', block: 'engine' },
    },
    {
        key: 'maxContext',
        label: 'Max context',
        description: 'The longest conversation the engine accepts. Raising it reserves more VRAM for the KV cache; with parallel it is shared across the lanes.',
        form: { kind: 'number', min: 256, max: 262144, step: 256, unit: 'tokens' },
        defaultValue: 4096,
        group: 'Memory',
        deploy: { target: 'config', format: 'json', block: 'models[]', key: 'max-context' },
    },
    {
        key: 'expertCache',
        label: 'Expert cache',
        description: 'How many expert blobs stay in VRAM. auto takes as many as fit after the weights and the reserve; a count pins the number.',
        form: { kind: 'combo', options: [...BASALT_EXPERT_CACHE_OPTIONS] },
        defaultValue: 'auto',
        group: 'Memory',
        deploy: { target: 'config', format: 'json', block: 'engine', key: 'expert-cache' },
    },
    {
        key: 'prefill',
        label: 'Prefill chunk',
        description: 'The prompt is read in batched chunks of this many tokens. auto takes the largest chunk the expert cache can lend; a number pins the chunk size.',
        form: { kind: 'text', placeholder: 'auto' },
        defaultValue: 'auto',
        group: 'Engine',
        deploy: { target: 'config', format: 'json', block: 'engine' },
    },
    {
        key: 'residentExperts',
        label: 'Resident experts',
        description: 'Keeps the experts the GPU does not hold in page-locked RAM, so none is read from the file again. Off falls back to a plain file mapping.',
        form: { kind: 'boolean' },
        defaultValue: true,
        group: 'Memory',
        deploy: { target: 'config', format: 'json', block: 'engine', key: 'resident-experts' },
    },
    {
        key: 'spec',
        label: 'Speculation',
        description: 'The drafter proposes tokens and the model verifies windows of at most this many. 0 or 1 turns speculation off; the default is 8 with a drafter.',
        form: { kind: 'number', min: 0, max: 16, step: 1, unit: 'tokens' },
        defaultValue: 8,
        group: 'Engine',
        deploy: { target: 'config', format: 'json', block: 'engine' },
    },
];
/**
 * The Basalt model key a config carries: the string `.basalt` model path,
 * falling back to an empty string so a bare config renders a plan the
 * adapter fills in with the downloaded model file. A value that names a
 * local artifact path passes through unchanged.
 */
export function basaltModelKey(config) {
    return typeof config.model === 'string' ? config.model : '';
}
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
export function basaltServedName(modelValue) {
    const file = basename(modelValue);
    if (file === BASALT_MODEL_FILE)
        return BASALT_SERVED_MODEL_ID;
    if (file === BASALT_DEEPSEEK_MODEL_FILE)
        return BASALT_DEEPSEEK_SERVED_MODEL_ID;
    return file;
}
//# sourceMappingURL=basalt.js.map
