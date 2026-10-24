/**
 * The Play/Run helper for the deps panel: runInstallFor refuses with a 409
 * while the trust gate is off (the copy/paste path is always the fallback),
 * runs the install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 * @module dsh-plugin-local-infer/ui/viewmodels/depsHelpers
 */
import { readConfig } from "../config.js";
import { RouteError } from "../route.js";
import { buildDeps } from "./deps.js";
/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 */
export async function runInstallFor(localInfer, request) {
    if (readConfig().allowRunDeps !== true) {
        throw new RouteError(409, 'one-click install is not allowed; copy the install string instead');
    }
    const model = await buildDeps(localInfer, request);
    const hardware = await localInfer.detectHardware();
    const result = await localInfer.runInstall(model.engineId, model.buildMode, hardware);
    const deps = model.deps.map((dep) => {
        const entry = result.results.find((entry) => entry.id === dep.id);
        return entry === undefined ? dep : { ...dep, status: entry.status };
    });
    return {
        result,
        deps: { ...model, deps, allSatisfied: result.ok },
    };
}
//# sourceMappingURL=depsHelpers.js.map