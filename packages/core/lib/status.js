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
 * 1. A provider whose engine the process probe confirmed running is running
 *    (green) when the detector tied that engine to the provider's exact model,
 *    and unsure (yellow) when the engine serves an unidentified or a
 *    different model. A running engine using its VRAM does not read as a busy
 *    card, so the dot is green, not the unattributable yellow.
 * 2. A provider whose engine is not running falls back to the card state: a
 *    busy card (a foreign engine holding the VRAM at 75% or more) reads as
 *    unsure, because a full card cannot be attributed to a single model, and
 *    a quiet card reads as stopped (red): the process probe saw no engine, so
 *    a saved config whose engine is down is stopped.
 */
export function computeProviderStatuses(input) {
    const statuses = {};
    for (const provider of input.providers) {
        // A provider that names a port only counts an engine running on that
        // port: two configs of one engine on different ports are distinct
        // engines, and a match on the other port must not confirm (or deny) this
        // config's model. An unnamed port keeps the engine-wide match.
        const matches = input.running.filter((ref) => ref.engineId === provider.engine &&
            (provider.port === undefined || ref.port === undefined || ref.port === provider.port));
        if (matches.length > 0) {
            // The engine is running. The question is which model it serves: the
            // detector's identified model, if it tied one, else unknown.
            const identified = matches.find((ref) => ref.modelId !== undefined && ref.modelId !== '');
            if (identified !== undefined &&
                provider.model !== undefined &&
                identified.modelId === provider.model) {
                statuses[provider.id] = 'running';
                continue;
            }
            // The engine is running but the model is not identified, the provider
            // names no model, or the engine serves a different model: unsure, not
            // a guess.
            statuses[provider.id] = 'unsure';
            continue;
        }
        // No engine of this provider's is running. A busy card (a foreign engine
        // holding the VRAM) reads as unsure; a quiet card reads as stopped.
        statuses[provider.id] = input.gpuBusy ? 'unsure' : 'stopped';
    }
    return statuses;
}
//# sourceMappingURL=status.js.map