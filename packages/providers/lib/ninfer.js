/**
 * NInfer parameter surface. The declarative `ParameterSpec` data for the
 * NInfer engine, sourced from `docs/serving.md`, `docs/cli.md`, and the
 * `inference-launcher/qwen-ninfer` script. Each spec carries its form kind,
 * a behavior-first description, the group it renders under, and the `toArgv`
 * spelling that turns a value into a `ninfer-serve` CLI flag.
 *
 * The data is the surface; the `NInferAdapter` (Phase 5) composes it into a
 * `LaunchPlan`. Adding a flag here is a data edit, never a core rewire.
 * @module @dsh/dsh-plugin-local-infer/providers/ninfer
 */
/**
 * The KV cache quantization formats NInfer serves, in the order the form
 * dropdown lists them. `note` carries the tradeoff text the dropdown shows
 * beside each choice.
 */
export const KV_DTYPE_OPTIONS = [
    { value: 'bf16', label: 'bf16', note: 'full precision; the widest KV pool' },
    { value: 'int8', label: 'int8', note: 'half the bytes of bf16; the everyday choice' },
    { value: 'fp8', label: 'fp8', note: 'half the bytes of bf16; the long-context tier on sm86' },
    { value: 'rk8v4', label: 'rk8v4', note: 'KVarN 8/4-bit; the quality choice for long context' },
    { value: 'rk4v4', label: 'rk4v4', note: 'KVarN 4/4-bit; the context choice, 31% smaller than rk8v4' },
    { value: 'k8v4', label: 'k8v4', note: 'KVarN 8-bit keys, 4-bit values; between rk8v4 and rk4v4' },
    { value: 'nvfp4', label: 'nvfp4', note: 'NVFP4; the smallest KV, needs SM 89 or newer' },
];
/**
 * The speculative-decoding backends. `none` loads no speculative backend at
 * all, which is the smallest resident profile.
 */
export const SPEC_OPTIONS = [
    { value: 'none', label: 'none', note: 'no speculative backend; the smallest resident profile' },
    { value: 'mtp', label: 'mtp', note: 'multi-token-prediction head; the 35B-A3B and 27B choice' },
    { value: 'dflash', label: 'dflash', note: 'DFlash; the 35B-A3B companion-weight backend' },
    {
        value: 'dflash2',
        label: 'dflash2',
        note: 'DFlash2; the Qwen3.8-27B companion-weight backend, draft counts 1..15',
    },
];
/**
 * The per-GPU kernel-schedule profiles. `auto` uses the stored or built-in
 * profile and calibrates a device that has none.
 */
export const DEVICE_PROFILE_OPTIONS = [
    { value: 'auto', label: 'auto', note: 'stored or built-in profile; calibrates an unknown GPU once' },
    { value: 'calibrate', label: 'calibrate', note: 'measure the routes anew on this GPU' },
    { value: 'off', label: 'off', note: 'keep the compiled routes as-is' },
];
/**
 * The chat templates the combo control offers as known choices. The plan
 * ships the popular templates as data, tagged with their source, and the
 * free-text half of the control accepts any local path or HF repo reference.
 */
export const CHAT_TEMPLATE_OPTIONS = [
    {
        value: 'froggeric/Qwen-Fixed-Chat-Templates',
        label: 'Froggeric22 (Qwen fixed chat templates)',
        note: 'popular template set from https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates',
        source: 'popular',
    },
];
/**
 * The speculation gate message the form shows while draftTokens and
 * lmHeadDraft are greyed out. It names the fix (pick a backend) and the
 * backends that unlock the fields, so a first-time user knows the next
 * click, not just the constraint.
 */
export const SPEC_GATE_MESSAGE = 'Pick a speculation backend first (mtp, dflash, or dflash2)';
/**
 * The NInfer `ParameterSpec` surface, in form order. The `group` field is the
 * form section; specs without a group render under `General`. `requires`
 * names the cross-parameter dependency in the message the form shows while
 * the field is disabled.
 */
export const NINFER_PARAMETERS = [
    {
        key: 'port',
        label: 'Port',
        description: 'The loopback port the engine serves its OpenAI endpoint and health check on. The registrar publishes it as the model base URL.',
        form: { kind: 'number', min: 1, max: 65535, step: 1 },
        // 18020 is the port the qwen-ninfer launcher binds, so the form seeds the
        // value the adapter's own fallback uses when a config names no port.
        defaultValue: 18020,
        group: 'Engine',
        // The port contributes no flag of its own: renderLaunch spells the local
        // `--port` and the docker host-port mapping from this value, and the
        // health URL and container name derive from it too.
    },
    {
        key: 'kvDtype',
        label: 'KV cache format',
        description: 'Quantizes the KV cache. Smaller formats fit a longer context in the same VRAM at a small quality cost.',
        form: { kind: 'enum', options: [...KV_DTYPE_OPTIONS] },
        defaultValue: 'int8',
        group: 'Memory',
        hardwareConstraint: (value, hw) => {
            // nvfp4 KV runs on SM 89 (Ada) and newer; a 30-series card (sm86) cannot
            // serve it, so the warning names the fix before the engine starts.
            if (value === 'nvfp4' && hw.gpu && hw.gpu.sm < 89) {
                return {
                    ok: false,
                    severity: 'error',
                    message: `nvfp4 KV needs SM 89 or newer; this card reports SM ${hw.gpu.sm}. Pick rk4v4 or k8v4.`,
                };
            }
            return { ok: true };
        },
        toArgv: (value) => ['--kv-dtype', String(value)],
    },
    {
        key: 'maxContext',
        label: 'Max context',
        description: 'The longest conversation the engine accepts. Raising it reserves more VRAM for the KV cache.',
        form: { kind: 'number', min: 256, max: 262144, step: 256, unit: 'tokens' },
        defaultValue: 32768,
        group: 'Memory',
        toArgv: (value) => ['--max-context', String(value)],
    },
    {
        key: 'kvCapacity',
        label: 'KV capacity',
        description: 'The shared KV pool across concurrent requests. Leave unset to size the pool from max-context.',
        form: { kind: 'number', min: 256, step: 256, unit: 'tokens' },
        group: 'Memory',
        toArgv: (value) => ['--kv-capacity', String(value)],
    },
    {
        key: 'hostKvMib',
        label: 'Host KV MiB',
        description: 'Pinned host RAM for the host KV tier. Retains inactive conversations when device memory is under pressure.',
        form: { kind: 'number', min: 0, step: 1024, unit: 'MiB' },
        group: 'Memory',
        toArgv: (value) => ['--host-kv-mib', String(value)],
    },
    {
        key: 'hostStateSlots',
        label: 'Host state slots',
        description: 'Pinned host state slots for the host state tier. Each slot retains a checkpoint image of an inactive conversation.',
        form: { kind: 'number', min: 0, step: 1, unit: 'slots' },
        group: 'Memory',
        toArgv: (value) => ['--host-state-slots', String(value)],
    },
    {
        key: 'mediaLiveMib',
        label: 'Media live MiB',
        description: 'Pinned host RAM reserved for live media (vision) decode. Retains the in-flight image and video buffers outside the GPU workspace.',
        form: { kind: 'number', min: 0, step: 1024, unit: 'MiB' },
        group: 'Memory',
        toArgv: (value) => ['--media-live-mib', String(value)],
    },
    {
        key: 'gdnStateFp16',
        label: 'GDN state in FP16',
        description: 'Keeps the recurrent state in FP16, halving its bytes in memory.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Memory',
        toArgv: (value) => (value === true ? ['--gdn-state-fp16'] : []),
    },
    {
        key: 'maxConcurrency',
        label: 'Max concurrency',
        description: 'How many requests decode at once. More lanes share the KV pool and cut per-request throughput.',
        form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'lanes' },
        defaultValue: 1,
        group: 'Concurrency',
        toArgv: (value) => ['--max-concurrency', String(value)],
    },
    {
        key: 'spec',
        label: 'Speculation backend',
        description: 'The speculative-decoding backend. Speeds decode when drafts are accepted; adds draft weights and CUDA graphs to resident memory.',
        form: { kind: 'enum', options: [...SPEC_OPTIONS] },
        defaultValue: 'none',
        group: 'Speculation',
        toArgv: (value) => (value === 'none' ? [] : ['--spec', String(value)]),
    },
    {
        key: 'draftTokens',
        label: 'Draft tokens',
        description: 'How many draft tokens a speculative round verifies. More drafts speed decode but cost more per round.',
        form: { kind: 'number', min: 1, max: 15, step: 1, unit: 'tokens' },
        defaultValue: 3,
        group: 'Speculation',
        requires: (config) => config.spec && config.spec !== 'none' ? null : SPEC_GATE_MESSAGE,
        toArgv: (value) => ['--draft-tokens', String(value)],
    },
    {
        key: 'lmHeadDraft',
        label: 'LM-head draft',
        description: 'Drafts from the small proposal head instead of the full output head, cutting the per-draft projection cost.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Speculation',
        requires: (config) => config.spec && config.spec !== 'none' ? null : SPEC_GATE_MESSAGE,
        toArgv: (value) => (value === true ? ['--lm-head-draft'] : []),
    },
    {
        key: 'temperature',
        label: 'Temperature',
        description: 'Sampling randomness. 0 decodes deterministically; higher values draw from a wider token distribution.',
        form: { kind: 'number', min: 0, max: 2, step: 0.05 },
        defaultValue: 0.9,
        group: 'Sampling',
        toArgv: (value) => ['--temperature', String(value)],
    },
    {
        key: 'minP',
        label: 'Min-p',
        description: 'Drops tokens whose probability falls under this fraction of the top token, trimming the sampling tail.',
        form: { kind: 'number', min: 0, max: 1, step: 0.01 },
        defaultValue: 0.05,
        group: 'Sampling',
        toArgv: (value) => ['--min-p', String(value)],
    },
    {
        key: 'defaultMaxTokens',
        label: 'Default max tokens',
        description: 'Caps the response length when a request names no max. Raises it for long answers; the engine still honours a per-request cap.',
        form: { kind: 'number', min: 1, step: 1, unit: 'tokens' },
        group: 'Sampling',
        toArgv: (value) => ['--default-max-tokens', String(value)],
    },
    {
        key: 'defaultThinkingBudget',
        label: 'Default thinking budget',
        description: 'Reserves reasoning tokens for a thinking model when a request names no budget. Higher budgets spend more time reasoning per turn.',
        form: { kind: 'number', min: 0, step: 1, unit: 'tokens' },
        group: 'Sampling',
        toArgv: (value) => ['--default-thinking-budget', String(value)],
    },
    {
        key: 'preserveThinking',
        label: 'Preserve thinking',
        description: 'Keeps the reasoning trace in the context across turns instead of dropping it, so a multi-turn conversation builds on its own prior reasoning.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Sampling',
        toArgv: (value) => (value === true ? ['--preserve-thinking'] : []),
    },
    {
        key: 'prefillChunk',
        label: 'Prefill chunk',
        description: 'The prompt-chunk size for prefill, in multiples of 128. The engine tunes it to the GPU; leave unset for the automatic size.',
        form: { kind: 'number', min: 128, step: 128, unit: 'tokens' },
        group: 'Engine',
        toArgv: (value) => ['--prefill-chunk', String(value)],
    },
    {
        key: 'vision',
        label: 'Vision input',
        description: 'Accepts image and video input. Adds the vision tower and its encode workspace to resident memory.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Engine',
        toArgv: (value) => (value === true ? ['--vision'] : []),
    },
    {
        key: 'structuredOutput',
        label: 'Structured output',
        description: 'Constrains the final answer with a JSON grammar. Reserves a grammar mask plane per draft position and lane.',
        form: { kind: 'boolean' },
        defaultValue: false,
        group: 'Engine',
        toArgv: (value) => (value === true ? ['--structured-output'] : []),
    },
    {
        key: 'deviceProfile',
        label: 'Device profile',
        description: 'The kernel schedule to use. auto calibrates once on an unknown GPU; off keeps the compiled routes.',
        form: { kind: 'enum', options: [...DEVICE_PROFILE_OPTIONS] },
        defaultValue: 'auto',
        group: 'Engine',
        toArgv: (value) => (value === 'auto' ? [] : ['--device-profile', String(value)]),
    },
    {
        key: 'chatTemplate',
        label: 'Chat template',
        description: 'Overrides the artifact built-in Jinja chat template. Pick a known template from the dropdown or type a custom path. Changes take effect after a restart.',
        form: { kind: 'combo', options: [...CHAT_TEMPLATE_OPTIONS] },
        group: 'Engine',
        toArgv: (value) => (value ? ['--chat-template', String(value)] : []),
    },
];
//# sourceMappingURL=ninfer.js.map