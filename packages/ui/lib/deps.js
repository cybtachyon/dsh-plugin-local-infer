/**
 * DepsModel is the render model the Web panel draws the "System dependencies"
 * section from: the per-dep status list (each with its purpose and sudo
 * flag), the copy/paste install string, the Play/Run trust gate, and the
 * "Get" gate the plan names (disabled until every dep reports satisfied).
 * The model is pure data the card draws, so the mapping stays unit-testable
 * here.
 * @module @dsh/dsh-plugin-local-infer/ui/deps
 */
/**
 * renderDeps maps the checkDeps results and the rendered install string to
 * the panel model. The "Get" gate is the plan's contract: it opens only when
 * every required dep reports satisfied, and an empty plan (nothing to
 * install) opens it, because there is nothing left to install.
 */
export function renderDeps(input) {
    const deps = input.checks.map(check => ({
        id: check.dep.id,
        purpose: check.dep.purpose,
        status: check.status,
        requiresSudo: check.dep.requiresSudo,
    }));
    return {
        engineId: input.engineId,
        buildMode: input.buildMode,
        packageManager: input.packageManager,
        deps,
        allSatisfied: deps.every((dep) => dep.status === 'satisfied'),
        installString: input.installString,
        runAllowed: input.runAllowed,
    };
}
//# sourceMappingURL=deps.js.map