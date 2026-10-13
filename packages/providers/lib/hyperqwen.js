/**
 * Hyper-Qwen parameter surface. The declarative `ParameterSpec` data for the
 * Hyper-Qwen (vLLM) engine, sourced from `.env.example`,
 * `docker-compose.yml`, and the `single-user`/`batch` start scripts. The
 * concepts mirror the NInfer surface; the spelling is a `.env` key the
 * `HyperQwenAdapter` (Phase 5) writes into the compose environment.
 * @module @dsh/dsh-plugin-local-infer/providers/hyperqwen
 */
/**
 * The speculative-decoding backends Hyper-Qwen serves. The launcher's own
 * default is `mtp`; the single-user speed profile sets `dflash2`.
 */
export const SPEC_OPTIONS = [
    { value: 'mtp', label: 'mtp', note: 'multi-token-prediction; the launcher default' },
    { value: 'dflash', label: 'dflash', note: 'DFlash draft-and-verify' },
    {
        value: 'dflash2',
        label: 'dflash2',
        note: 'DFlash2; the faster single-user profile, forces the vLLM V2 runner',
    },
];
/**
 * The context profiles. `fast` is the 64k default; `long` trades decode rate
 * for ~150k; `huge` uses the KVarN 4/2-bit KV cache for 240k.
 */
export const CTX_OPTIONS = [
    { value: 'fast', label: 'fast', note: '64k context at the highest decode rate' },
    { value: 'long', label: 'long', note: '~150k context at ~95-100 tok/s' },
    {
        value: 'huge',
        label: 'huge',
        note: '240k context via the KVarN 4/2-bit KV cache, ~67 tok/s',
    },
];
/**
 * The KV cache formats the vLLM engine serves. `fp8` is the batch default;
 * `kvarn` is the 4/2-bit cache the `huge` profile uses.
 */
export const KV_OPTIONS = [
    { value: 'bf16', label: 'bf16', note: 'full precision; the fast profile' },
    { value: 'int8', label: 'int8', note: 'the flashinfer-free fallback tier' },
    { value: 'fp8', label: 'fp8', note: 'the long-context tier; the batch default' },
    { value: 'kvarn', label: 'kvarn', note: 'KVarN 4-bit key / 2-bit value; the huge-context tier' },
    { value: 'int4pth', label: 'int4pth', note: 'vLLM int4 per-token-head KV on the Triton backend' },
];
/**
 * The Hyper-Qwen `ParameterSpec` surface, in form order. Every spec's `toEnv`
 * is the `.env` key the compose file passes straight into the container; the
 * adapter composes them into the launch plan.
 */
export const HYPERQWEN_PARAMETERS = [
    {
        key: 'spec',
        label: 'Speculation backend',
        description: 'The speculative-decoding backend. Speeds decode when drafts are accepted; dflash2 is the faster single-user profile.',
        form: { kind: 'enum', options: [...SPEC_OPTIONS] },
        defaultValue: 'mtp',
        group: 'Speculation',
        toEnv: (value) => ['SPEC', String(value)],
    },
    {
        key: 'draftTokens',
        label: 'Draft tokens',
        description: 'How many draft tokens a speculative round verifies. 15 is the copy/edit/quote mode: much faster when the answer reuses context, at the cost of request slots and context headroom.',
        form: { kind: 'number', min: 1, max: 15, step: 1, unit: 'tokens' },
        defaultValue: 7,
        group: 'Speculation',
        requires: (config) => config.spec === 'dflash' || config.spec === 'dflash2'
            ? null
            : 'SPEC must be dflash or dflash2; mtp uses its fixed draft count',
        toEnv: (value) => ['DFLASH_TOKENS', String(value)],
    },
    {
        key: 'ctx',
        label: 'Context profile',
        description: 'The context tier. long trades decode rate for ~150k context; huge uses the KVarN 4/2-bit KV cache for 240k at ~67 tok/s.',
        form: { kind: 'enum', options: [...CTX_OPTIONS] },
        defaultValue: 'fast',
        group: 'Memory',
        toEnv: (value) => ['CTX', String(value)],
    },
    {
        key: 'kv',
        label: 'KV cache format',
        description: 'The KV cache format. kvarn is the 4/2-bit cache the huge tier uses; fp8 is the fast long-context tier.',
        form: { kind: 'enum', options: [...KV_OPTIONS] },
        defaultValue: 'fp8',
        group: 'Memory',
        toEnv: (value) => ['KV', String(value)],
    },
    {
        key: 'gpuUtil',
        label: 'GPU utilization',
        description: 'The share of GPU memory the engine reserves. The single-user default is 0.93; lower it when WSL2 or Docker is tight and the server refuses to boot.',
        form: { kind: 'number', min: 0.1, max: 1, step: 0.01 },
        defaultValue: 0.93,
        group: 'Memory',
        toEnv: (value) => ['GPU_UTIL', String(value)],
    },
    {
        key: 'maxLen',
        label: 'Max length',
        description: 'The context ceiling for the active profile. The profile picks its own default; an explicit value overrides it.',
        form: { kind: 'number', min: 2048, step: 1024, unit: 'tokens' },
        group: 'Memory',
        toEnv: (value) => ['MAX_LEN', String(value)],
    },
    {
        key: 'maxSeqs',
        label: 'Max sequences',
        description: 'How many sequences run at once. The real limit is the resident-state pool, so leave it at the default in single-user mode.',
        form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'sequences' },
        group: 'Concurrency',
        toEnv: (value) => ['MAX_SEQS', String(value)],
    },
    {
        key: 'vision',
        label: 'Vision input',
        description: 'Accepts image input. Adds the vision tower and its processor to the engine.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Engine',
        toEnv: (value) => ['VISION', value === true ? '1' : '0'],
    },
    {
        key: 'pinMemory',
        label: 'WSL2 pin memory',
        description: 'Enables pinned memory for the WSL2 V2 runner. dflash2 aborts at boot on WSL2 without it; on native Linux the flag is a no-op.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Engine',
        toEnv: (value) => ['VLLM_WSL2_ENABLE_PIN_MEMORY', value === true ? '1' : '0'],
    },
    {
        key: 'prefixCache',
        label: 'Prefix cache',
        description: 'Keeps the prefix cache across requests. The first turn over a long document is the expensive one; later turns reuse it.',
        form: { kind: 'boolean' },
        defaultValue: true,
        group: 'Engine',
        toEnv: (value) => ['PREFIX_CACHE', value === true ? '1' : '0'],
    },
    {
        key: 'apiKey',
        label: 'API key',
        description: 'The key the OpenAI endpoint checks. Required before the port is reachable by anything but this machine.',
        form: { kind: 'text', placeholder: 'openssl rand -hex 24' },
        group: 'Network',
        toEnv: (value) => ['VLLM_API_KEY', String(value ?? '')],
    },
    {
        key: 'port',
        label: 'Port',
        description: 'The port the OpenAI endpoint listens on. Change it only to avoid a local port conflict.',
        form: { kind: 'number', min: 1, max: 65535, step: 1 },
        defaultValue: 18020,
        group: 'Network',
        toEnv: (value) => ['PORT', String(value)],
    },
];
//# sourceMappingURL=hyperqwen.js.map