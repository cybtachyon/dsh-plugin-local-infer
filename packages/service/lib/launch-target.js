/**
 * The stored provider entry a launch, stop, or run-log write targets. The
 * rule the ui's launch-record paths carried privately moves here so the
 * record persistence and the run-log key rule share one matcher.
 * @module dsh-plugin-local-infer/service/launch-target
 */
/**
 * findLaunchTarget resolves the stored provider entry a launch, stop, or
 * run targets: the entry the request names by id, or (an id the card does
 * not send, a launch of the active config) the stored entry with the same
 * engine and model. A request with no resolvable entry reads as undefined,
 * which the launch-record paths take as "no provider config to re-link" and
 * the run-log key rule takes as "key on the engine id". The entry type
 * stays generic so each caller keeps its own stored entry shape.
 */
export function findLaunchTarget(providers, engineId, providerId, config) {
    if (providerId !== undefined) {
        const byId = providers.find((entry) => entry.id === providerId);
        if (byId !== undefined)
            return byId;
    }
    const model = typeof config.model === 'string' ? config.model : undefined;
    if (model === undefined)
        return undefined;
    return providers.find((entry) => entry.engine === engineId &&
        (typeof entry.config.model === 'string' ? entry.config.model : undefined) === model);
}
//# sourceMappingURL=launch-target.js.map
