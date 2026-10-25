/**
 * Built-in hardware guidelines. The rules that every engine shares, expressed
 * as `Guideline` data over (config, hardware): the docker-availability gate,
 * the host RAM tier ceiling, and the WSL2 pin-memory boot abort. Each is
 * registered with `ctx.localInfer` by the provider `apply`, so a per-engine
 * override or an extra rule composes on top without touching these.
 *
 * The rules that need the registered VramModel (the estimator-backed
 * "exceeds usable VRAM" and "spec needs draft weights" rules) live in the
 * core `modelGuidelines` and run in the service, because they price against
 * a model, not against the hardware alone.
 * @module dsh-plugin-local-infer/providers/guidelines
 */
import { infernixDraftModelPath } from "./engines/infernix.js";
/**
 * One pinned Host StateImage, in bytes. The NInfer measured figure for the
 * 27B artifact (195,897,344 B, the README's Host StateImage size), used as
 * the per-slot cost the host RAM rule sums. A StateImage costs this much
 * regardless of the prefix depth it resumes, so the slot count, not the
 * context length, is what pins host RAM.
 */
export const HOST_STATE_IMAGE_BYTES = 195_897_344;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/**
 * The built-in guideline set, in the order the panel lists them. Levels:
 * `error` for a state the engine cannot boot from, `warn` for a state that
 * degrades before it breaks.
 */
export const BUILTIN_GUIDELINES = [
    {
        id: 'docker-not-installed',
        level: 'error',
        message: 'Docker is selected but not installed. Install docker and the NVIDIA Container Toolkit, or switch to a local build.',
        when: (config, hw) => !hw.dockerAvailable &&
            (config.buildMode === 'docker' || config.engine === 'hyperqwen'),
    },
    {
        id: 'host-tiers-exceed-host-ram',
        level: 'warn',
        message: 'The host KV and state tiers pin more host RAM than this machine reports. Lower hostKvMib or hostStateSlots.',
        anchors: ['hostKvMib', 'hostStateSlots'],
        when: (config, hw) => {
            const kvMib = typeof config.hostKvMib === 'number' ? config.hostKvMib : 0;
            const slots = typeof config.hostStateSlots === 'number' ? config.hostStateSlots : 0;
            if (kvMib <= 0 && slots <= 0)
                return false;
            if (hw.hostRamGiB === undefined)
                return false;
            const pinned = kvMib * MIB + slots * HOST_STATE_IMAGE_BYTES;
            return pinned > hw.hostRamGiB * GIB;
        },
    },
    {
        id: 'wsl2-dflash2-needs-pin-memory',
        level: 'error',
        message: 'dflash2 aborts at boot on WSL2 without pinned memory. Enable the WSL2 pin memory flag (VLLM_WSL2_ENABLE_PIN_MEMORY=1).',
        anchors: ['pinMemory'],
        when: (config, hw) => hw.wsl2 && config.spec === 'dflash2' && config.pinMemory !== true,
    },
    {
        // The Infernix dflash2 backend always loads a drafter through
        // --draft-model, so a config that selects dflash2 but names no drafter
        // path (no preset, no Custom path) cannot boot. The rule is Infernix-
        // specific: only Infernix configs carry the draftModelPreset key, so a
        // NInfer dflash2 (which rides the model's own companion weights) never
        // fires it.
        id: 'infernix-dflash2-needs-draft-model',
        level: 'error',
        message: 'dflash2 needs a draft model. Select a DFlash2 model, or switch to Custom and set the Draft model path.',
        anchors: ['draftModelPreset', 'draftModel'],
        when: (config) => config.spec === 'dflash2' &&
            'draftModelPreset' in config &&
            infernixDraftModelPath(config) === null,
    },
];
//# sourceMappingURL=guidelines.js.map