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
/**
 * The KV cache quantization formats llama.cpp serves. `f16` is the full-
 * precision default; the smaller tiers trade a little quality for a longer
 * context in the same memory.
 */
export const KV_CACHE_TYPE_OPTIONS = [
    { value: 'f16', label: 'f16', note: 'full precision; the default' },
    { value: 'q8_0', label: 'q8_0', note: '8-bit; a small memory saving' },
    { value: 'q4_0', label: 'q4_0', note: '4-bit; the context choice, a quarter of the bytes' },
    { value: 'q4_1', label: 'q4_1', note: '4-bit with a per-block scale; between q4_0 and q5_0' },
    { value: 'q5_0', label: 'q5_0', note: '5-bit; a middle tier' },
    { value: 'q5_1', label: 'q5_1', note: '5-bit with a per-block scale' },
];
/**
 * The llama.cpp model artifacts, keyed by the config model key. The 27B entry
 * is the Qwen3.8-27B GGUF the launcher downloads; an id no entry names falls
 * back to it, so a bare config always renders a plan.
 */
export const LLAMACPP_MODEL_ARTIFACTS = {
    'qwen3-27b': {
        file: 'Qwen3-8-27B-q4_k_m.gguf',
        repo: 'Qwen/Qwen3.8-27B-GGUF',
        modelId: 'Qwen3.8-27B',
    },
};
/**
 * The llama.cpp `ParameterSpec` surface, in form order. The `group` field is
 * the form section; specs without a group render under `General`. The `port`
 * the engine listens on is a config value the adapter reads (the NInfer
 * pattern), not a spec, so the docker plan maps the host port onto the
 * container's fixed internal port without a duplicate flag.
 */
export const LLAMACPP_PARAMETERS = [
    {
        key: 'ctxSize',
        label: 'Context size',
        description: 'The longest sequence the engine accepts. Raising it reserves more memory for the KV cache.',
        form: { kind: 'number', min: 512, max: 262144, step: 512, unit: 'tokens' },
        defaultValue: 4096,
        group: 'Memory',
        toArgv: (value) => ['--ctx-size', String(value)],
    },
    {
        key: 'gpuLayers',
        label: 'GPU layers',
        description: 'How many layers offload to the GPU. 99 offloads every layer; 0 keeps the model on the CPU.',
        form: { kind: 'number', min: 0, max: 99, step: 1 },
        defaultValue: 99,
        group: 'Memory',
        toArgv: (value) => ['--n-gpu-layers', String(value)],
    },
    {
        key: 'kvCacheType',
        label: 'KV cache format',
        description: 'The KV cache quantization. Smaller formats fit a longer context in the same memory at a small quality cost.',
        form: { kind: 'enum', options: [...KV_CACHE_TYPE_OPTIONS] },
        defaultValue: 'f16',
        group: 'Memory',
        // llama.cpp prices the key and value caches separately; the engine serves
        // both from the same tier, so one value spells both flags.
        toArgv: (value) => ['--cache-type-k', String(value), '--cache-type-v', String(value)],
    },
    {
        key: 'threads',
        label: 'CPU threads',
        description: 'The CPU threads the engine uses for the layers it does not offload. Match the physical cores for best throughput.',
        form: { kind: 'number', min: 1, step: 1, unit: 'threads' },
        group: 'Engine',
        toArgv: (value) => ['--threads', String(value)],
    },
    {
        key: 'batchSize',
        label: 'Batch size',
        description: 'The prompt-processing batch size. Larger batches prefill faster on a GPU, at the cost of more memory.',
        form: { kind: 'number', min: 32, step: 32, unit: 'tokens' },
        group: 'Engine',
        toArgv: (value) => ['--batch-size', String(value)],
    },
    {
        key: 'parallel',
        label: 'Parallel slots',
        description: 'How many sequences the engine runs at once. More slots serve more requests, each sharing the KV cache.',
        form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'slots' },
        defaultValue: 1,
        group: 'Concurrency',
        toArgv: (value) => ['--parallel', String(value)],
    },
    {
        key: 'temp',
        label: 'Temperature',
        description: 'Sampling randomness. 0 decodes deterministically; higher values draw from a wider token distribution.',
        form: { kind: 'number', min: 0, max: 2, step: 0.05 },
        defaultValue: 0.9,
        group: 'Sampling',
        toArgv: (value) => ['--temp', String(value)],
    },
    {
        key: 'topP',
        label: 'Top-p',
        description: 'Nucleus sampling: keeps the smallest set of tokens whose cumulative probability reaches this fraction.',
        form: { kind: 'number', min: 0, max: 1, step: 0.01 },
        defaultValue: 0.95,
        group: 'Sampling',
        toArgv: (value) => ['--top-p', String(value)],
    },
    {
        key: 'flashAttn',
        label: 'Flash attention',
        description: 'Enables flash attention for the attention kernel, cutting the memory the attention pass holds.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Engine',
        toArgv: (value) => (value === true ? ['--flash-attn'] : []),
    },
    {
        key: 'jinja',
        label: 'Jinja chat template',
        description: 'Uses the model built-in Jinja chat template instead of the legacy format, matching the model card.',
        form: { kind: 'boolean' },
        defaultValue: true,
        group: 'Engine',
        toArgv: (value) => (value === true ? ['--jinja'] : []),
    },
];
/**
 * The config value the llama.cpp adapter reads for the port and the model.
 * The port defaults to 8080, the llama.cpp default; the model defaults to the
 * 27B artifact key. A config that names neither renders a bare plan.
 */
export function llamaCppModelKey(config) {
    return typeof config.model === 'string' ? config.model : 'qwen3-27b';
}
//# sourceMappingURL=llamacpp.js.map