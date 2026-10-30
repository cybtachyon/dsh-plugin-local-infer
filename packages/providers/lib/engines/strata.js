/**
 * Strata parameter surface. The declarative `ParameterSpec` data for the
 * Strata engine (https://github.com/Niko1221/Strata), sourced from the
 * repository's `docs/AI_SETUP.md` (the `strata launch` flags) and
 * `docs/DOCKER.md` (the container environment variables). Each spec carries
 * both a `toArgv` spelling (the `strata launch` flag the binary and source
 * build modes pass) and a `toEnv` spelling (the container variable the docker
 * mode passes), so the one surface renders every build mode.
 *
 * The data is the surface; the `StrataAdapter` composes it into a `LaunchPlan`.
 * Adding a flag here is a data edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/strata
 */
/**
 * The model families Strata serves. `qwen` is the Qwen3.8-Flash-Next family
 * (the default); the others are the size-specific variants the README's
 * Models section names.
 */
export const STRATA_FAMILY_OPTIONS = [
    { value: 'qwen', label: 'qwen', note: 'the Qwen3.8-Flash-Next family; the default' },
    { value: 'swift', label: 'swift', note: 'Swift 1.5; thinks shorter before it answers' },
    { value: 'coder', label: 'coder', note: 'keeps the experts code uses; the 32 GB code pick' },
    {
        value: 'unsloth',
        label: 'unsloth',
        note: 'Unsloth UD-IQ4_XS / Q4_K_XL; closest to the full model',
    },
];
/**
 * The picture-reader modes. `on` lets the engine pick the CPU reader under a
 * 24 GB card and the GPU reader from 24 GB; `gpu` and `cpu` force a side.
 */
export const STRATA_VISION_OPTIONS = [
    { value: 'off', label: 'off', note: 'no picture reading' },
    {
        value: 'on',
        label: 'on',
        note: 'read pictures; the reader runs on the CPU under 24 GB, the GPU from 24 GB',
    },
    { value: 'gpu', label: 'gpu', note: 'force the GPU picture reader' },
    { value: 'cpu', label: 'cpu', note: 'force the CPU picture reader' },
];
/**
 * The tuning modes. `skip` is the engine default (no tuning run); `quick` is
 * a one-time run of up to about 20 minutes; `thorough` is a longer run.
 */
export const STRATA_TUNE_OPTIONS = [
    { value: 'skip', label: 'skip', note: 'no tuning; the engine default' },
    { value: 'quick', label: 'quick', note: 'up to about 20 minutes, once' },
    { value: 'thorough', label: 'thorough', note: 'a longer tuning run' },
];
/**
 * The access modes. `local` listens on 127.0.0.1 only and needs no key; every
 * other mode makes a key for you, because the server is then reachable beyond
 * this machine.
 */
export const STRATA_ACCESS_OPTIONS = [
    { value: 'local', label: 'local', note: 'listen on 127.0.0.1 only; no key needed' },
    { value: 'lan', label: 'lan', note: 'reachable from the network; a key is made for you' },
    {
        value: 'cloudflare',
        label: 'cloudflare',
        note: 'a Cloudflare tunnel; a key is made for you',
    },
    { value: 'tailscale', label: 'tailscale', note: 'a Tailscale network; a key is made for you' },
];
/**
 * The Strata `ParameterSpec` surface, in form order. The `group` field is the
 * form section; specs without a group render under `General`. The `toArgv`
 * spelling is the `strata launch` flag the binary and source-build modes pass;
 * the `toEnv` spelling is the container variable the docker mode passes. A
 * spec with no `toEnv` (access, dataDir) has no docker counterpart, and a spec
 * with no `toArgv` (port) is spelled by the adapter from the value.
 */
export const STRATA_PARAMETERS = [
    {
        key: 'port',
        label: 'Port',
        description: 'The loopback port the engine serves its OpenAI endpoint and health check on. The registrar publishes it as the model base URL.',
        // The port is a typed number, not a range strip: a 1..65535 drag slider is
        // noise, so `slider: false` renders the plain number entry only.
        form: { kind: 'number', min: 1, max: 65535, step: 1, slider: false },
        // 8080 is the port the strata launch CLI binds by default, so the form
        // seeds the value the adapter's own fallback uses when a config names no
        // port.
        defaultValue: 8080,
        group: 'Engine',
        // The port contributes no flag of its own: renderLaunch spells the local
        // --port and the docker host-port mapping from this value, and the health
        // URL and container name derive from it too.
    },
    {
        key: 'family',
        label: 'Model family',
        description: 'The model version when a size exists in several families. qwen is the Qwen3.8-Flash-Next family; the others are the size-specific variants.',
        form: { kind: 'enum', options: [...STRATA_FAMILY_OPTIONS] },
        defaultValue: 'qwen',
        group: 'Model',
        toArgv: (value) => ['--family', String(value)],
        toEnv: (value) => ['FAMILY', String(value)],
    },
    {
        key: 'context',
        label: 'Context',
        description: 'How much text the model remembers at once: 32k, 64k, 128k, 256k, or a token count. Leave unset and the engine picks the largest that fits.',
        form: { kind: 'text', placeholder: '128k' },
        group: 'Memory',
        toArgv: (value) => (value ? ['--context', String(value)] : []),
        // envFromSpecs only calls toEnv when the value is set, so the pair is
        // always well-formed here.
        toEnv: (value) => ['CONTEXT', String(value)],
    },
    {
        key: 'vision',
        label: 'Vision input',
        description: 'Whether the model reads pictures. On by default when the model can read them; the reader runs on the CPU under a 24 GB card and on the GPU from 24 GB.',
        form: { kind: 'enum', options: [...STRATA_VISION_OPTIONS] },
        defaultValue: 'on',
        group: 'Engine',
        toArgv: (value) => ['--vision', String(value)],
        toEnv: (value) => ['VISION', String(value)],
    },
    {
        key: 'parallel',
        label: 'Parallel requests',
        description: 'How many requests decode at once, 1 to 8. More lanes share the model and cut per-request throughput. Leave unset and the engine fits the count to the card.',
        form: { kind: 'number', min: 1, max: 8, step: 1, unit: 'lanes' },
        group: 'Concurrency',
        toArgv: (value) => (value === undefined ? [] : ['--parallel', String(value)]),
        toEnv: (value) => ['PARALLEL', String(value)],
    },
    {
        key: 'gpu',
        label: 'GPU',
        description: 'Card numbers the model shares, e.g. 0 or 0,1. Empty lets the engine choose the card with the most VRAM.',
        form: { kind: 'text', placeholder: '0' },
        group: 'Engine',
        toArgv: (value) => (value ? ['--gpu', String(value)] : []),
        toEnv: (value) => ['GPU', String(value)],
    },
    {
        key: 'tune',
        label: 'Tune',
        description: 'Find the fastest settings first. quick is a one-time run of up to about 20 minutes; thorough is longer. skip is the default.',
        form: { kind: 'enum', options: [...STRATA_TUNE_OPTIONS] },
        defaultValue: 'skip',
        group: 'Engine',
        toArgv: (value) => ['--tune', String(value)],
        toEnv: (value) => ['TUNE', String(value)],
    },
    {
        key: 'access',
        label: 'Access',
        description: 'Who may connect. local listens on 127.0.0.1 only and needs no key; beyond local the engine makes a key for you. The docker mode reaches this through the API key and the published port instead.',
        form: { kind: 'enum', options: [...STRATA_ACCESS_OPTIONS] },
        defaultValue: 'local',
        group: 'Engine',
        // local is the engine default, so the bare value spells no flag.
        toArgv: (value) => (value === 'local' ? [] : ['--access', String(value)]),
    },
    {
        key: 'apiKey',
        label: 'API key',
        description: 'The key clients must send when access is beyond local. Leave unset and the engine makes one and keeps it in its data volume.',
        form: { kind: 'text', placeholder: 'openssl rand -hex 24' },
        group: 'Engine',
        toArgv: (value) => (value ? ['--api-key', String(value)] : []),
        toEnv: (value) => ['API_KEY', String(value)],
    },
    {
        key: 'modelPath',
        label: 'Model path',
        description: 'GGUF files you already have: a folder of shards or one .gguf file. Nothing is downloaded for the model itself when this is set.',
        form: { kind: 'path' },
        group: 'Artifacts',
        toArgv: (value) => (value ? ['--model-path', String(value)] : []),
        toEnv: (value) => ['MODEL_PATH', String(value)],
    },
    {
        key: 'dataDir',
        label: 'Data directory',
        description: 'Where new model files go. Models you already have stay where they are and stay usable.',
        form: { kind: 'path' },
        group: 'Artifacts',
        toArgv: (value) => (value ? ['--data-dir', String(value)] : []),
    },
];
/**
 * The Strata model key a config carries: the string model value, falling back
 * to an empty string so a bare config renders a plan the engine sizes for the
 * card (the engine picks the model when none is named). A value that names a
 * local artifact file passes through unchanged.
 */
export function strataModelKey(config) {
    return typeof config.model === 'string' ? config.model : '';
}
/**
 * strataSourceLaunchArgs renders the source-build wrapper argv shared by every
 * OS. The wrapper's `--vision` takes yes|no|gpu|cpu, so the surface's on|off
 * maps onto it (gpu and cpu pass through). The command name is the one
 * OS-specific piece, supplied by the caller (setup.sh on Linux/Mac,
 * START-HERE.bat on Windows).
 */
export function strataSourceLaunchArgs(command, args) {
    // The wrapper's --vision takes yes|no|gpu|cpu; the surface's on|off maps onto
    // it (gpu and cpu pass through).
    const visionFlag = args.vision === 'on' ? 'yes' : args.vision === 'off' ? 'no' : args.vision;
    return [
        command,
        '--yes',
        ...(args.model !== '' ? ['--model', args.model] : []),
        ...(args.family !== 'qwen' ? ['--family', args.family] : []),
        '--vision',
        visionFlag,
        ...(args.context !== undefined ? ['--context', args.context] : []),
        '--port',
        String(args.port),
        ...args.customArgs,
    ];
}
//# sourceMappingURL=strata.js.map