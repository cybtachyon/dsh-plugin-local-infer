/**
 * Built-in preset data for the local-inference defaults layer. The presets are
 * the offline floor the DefaultsResolver resolves against: the NInfer
 * measured configs (the `config-calculator.html` figures and the
 * `qwen-ninfer` launcher, on a 24 GiB sm86 card) and the Hyper-Qwen `.env`
 * profiles (the single-user speed, long-context, and huge-context tiers from
 * `.env.example`). Each preset is keyed by its exact (engine, model, hardware
 * class) triple, so it is only trusted for the hardware it was sourced for.
 *
 * The `PRESET_SOURCES` list names the mod-search fetch path: the URL the
 * bridge pulls and the pure extractor that turns the fetched page into a
 * preset. The service runs the fetch and tags the result with the URL and the
 * fetch date.
 * @module dsh-plugin-local-infer/providers/presets
 */
/**
 * The hardware class every built-in preset is sourced for: a 24 GiB Ampere
 * (sm86) card, the card the NInfer constants were measured on and the card the
 * Hyper-Qwen `.env` profiles target.
 */
const RTX_3090 = '24g-sm86';
/**
 * The NInfer measured presets, one per model artifact, on the 24 GiB sm86 card.
 * The values are the launcher's working config with the KV format set to the
 * sm86-safe tier (int8, the calculator's quality default; nvfp4 needs SM 89).
 */
const NINFER_PRESETS = [
    {
        engineId: 'ninfer',
        modelId: 'qwen3-27b',
        hardwareClass: RTX_3090,
        values: {
            kvDtype: 'int8',
            maxContext: 262144,
            spec: 'mtp',
            draftTokens: 7,
            lmHeadDraft: true,
            temperature: 0.9,
            minP: 0.05,
            prefillChunk: 4096,
            maxConcurrency: 1,
            gdnStateFp16: true,
            hostKvMib: 49152,
            hostStateSlots: 16,
            vision: true,
            chatTemplate: 'qwen3_8',
        },
        source: 'NInfer measured (config-calculator.html, RTX 3090 24 GiB sm86)',
    },
    {
        engineId: 'ninfer',
        modelId: 'qwen3-35b',
        hardwareClass: RTX_3090,
        values: {
            kvDtype: 'int8',
            maxContext: 32768,
            spec: 'dflash',
            draftTokens: 7,
            temperature: 0.9,
            minP: 0.05,
            prefillChunk: 4096,
            maxConcurrency: 1,
        },
        source: 'NInfer measured (config-calculator.html, RTX 3090 24 GiB sm86)',
    },
];
/**
 * The Hyper-Qwen `.env` profile presets, on the 24 GiB sm86 card. The values
 * are the `.env` keys the `HyperQwenAdapter` maps onto the compose
 * environment; the three tiers are the single-user speed-first default, the
 * long-context tier, and the huge-context (KVarN 4/2-bit) tier.
 */
const HYPERQWEN_PRESETS = [
    {
        engineId: 'hyperqwen',
        modelId: 'qwen3-27b',
        hardwareClass: RTX_3090,
        values: {
            spec: 'dflash2',
            draftTokens: 7,
            prefixCache: true,
            pinMemory: true,
            ctx: 'fast',
            kv: 'fp8',
            gpuUtil: 0.93,
        },
        source: 'Hyper-Qwen .env.example (single-user speed-first)',
        // The `.env.example` names this the recommended default for a card the
        // user owns alone, so the resolver auto-picks it for the triple.
        label: 'single-user speed-first',
        isDefault: true,
    },
    {
        engineId: 'hyperqwen',
        modelId: 'qwen3-27b',
        hardwareClass: RTX_3090,
        values: {
            spec: 'mtp',
            ctx: 'long',
            kv: 'fp8',
            prefixCache: true,
        },
        source: 'Hyper-Qwen .env.example (long-context)',
        label: 'long-context',
    },
    {
        engineId: 'hyperqwen',
        modelId: 'qwen3-27b',
        hardwareClass: RTX_3090,
        values: {
            spec: 'dflash2',
            draftTokens: 7,
            ctx: 'huge',
            kv: 'kvarn',
            prefixCache: true,
        },
        source: 'Hyper-Qwen .env.example (huge-context)',
        label: 'huge-context',
    },
];
/**
 * BUILTIN_PRESETS is the combined preset list the providers register with the
 * seam. Adding a preset is a data edit here, never a resolver change.
 */
export const BUILTIN_PRESETS = [...NINFER_PRESETS, ...HYPERQWEN_PRESETS];
/**
 * extractJsonBlock reads the first fenced ```json block out of a fetched page
 * and parses it as the preset values. A page with no json block (or a broken
 * one) extracts an empty config, which the resolver reads as "the preset
 * contributed nothing" rather than a guess.
 */
export function extractJsonBlock(content) {
    const match = content.match(/```json\s*([\s\S]*?)```/);
    if (match === null || match[1] === undefined)
        return {};
    try {
        const parsed = JSON.parse(match[1]);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
/**
 * PRESET_SOURCES names the mod-search fetch path: the NInfer docs source the
 * bridge pulls to refresh the 24 GiB sm86 preset. The extractor reads the json
 * block the docs embed, so a page without one degrades to an empty config.
 */
export const PRESET_SOURCES = [
    {
        engineId: 'ninfer',
        modelId: 'qwen3-27b',
        hardwareClass: RTX_3090,
        url: 'https://raw.githubusercontent.com/iamwavecut/ninfer-all/master/docs/device-profiles.md',
        source: 'NInfer docs (device-profiles.md)',
        extract: extractJsonBlock,
    },
];
//# sourceMappingURL=presets.js.map