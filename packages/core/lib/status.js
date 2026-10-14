import { GPU_USAGE_BUSY_THRESHOLD } from "./reserve.js";
/**
 * isGpuBusy reports whether a GPU usage reading reads the card as busy: the
 * used VRAM at 75% of the total or more. A missing reading or an empty total
 * is not busy, so a host the detector cannot read never reads as busy.
 */
export function isGpuBusy(usage) {
    if (usage === null || usage === undefined)
        return false;
    if (usage.totalMiB <= 0)
        return false;
    return usage.usedMiB / usage.totalMiB >= GPU_USAGE_BUSY_THRESHOLD;
}
/**
 * computeProviderStatuses resolves each saved provider's running-state from
 * the detector's answer. The order is the plan's contract:
 * 1. A busy card (VRAM at 75% or more) reads as unsure for every provider,
 *    because a full card cannot be attributed to a single model.
 * 2. No engine running at all reads as unsure for every provider: the
 *    detector saw nothing, so it cannot tell a stopped engine from a
 *    detection miss.
 * 3. With at least one engine running, a provider whose engine is not among
 *    the running set is stopped (red). A provider whose engine is running
 *    is running (green) only when the detector tied that engine to the
 *    provider's exact model; an engine the detector saw but could not tie
 *    to a model reads as unsure (yellow), which is the "all configs with
 *    that engine are unsure, the rest are red" case.
 */
export function computeProviderStatuses(input) {
    const statuses = {};
    if (input.gpuBusy || input.running.length === 0) {
        for (const provider of input.providers) {
            statuses[provider.id] = 'unsure';
        }
        return statuses;
    }
    for (const provider of input.providers) {
        const matches = input.running.filter((ref) => ref.engineId === provider.engine);
        if (matches.length === 0) {
            statuses[provider.id] = 'stopped';
            continue;
        }
        // The engine is running. The question is which model it serves: the
        // detector's identified model, if it tied one, else unknown.
        const identified = matches.find((ref) => ref.modelId !== undefined && ref.modelId !== '');
        if (identified === undefined) {
            // Engine running but no model identified: the "engine running, model
            // unknown" case, which reads as unsure for this engine's configs.
            statuses[provider.id] = 'unsure';
            continue;
        }
        if (provider.model !== undefined && identified.modelId === provider.model) {
            statuses[provider.id] = 'running';
            continue;
        }
        if (provider.model === undefined) {
            // The provider names no model, so it cannot be confirmed against the
            // identified one: unsure rather than a guess.
            statuses[provider.id] = 'unsure';
            continue;
        }
        // The engine serves an identified model that is not this provider's:
        // the provider's model is not the one live, so it reads as stopped.
        statuses[provider.id] = 'stopped';
    }
    return statuses;
}
//# sourceMappingURL=status.js.map