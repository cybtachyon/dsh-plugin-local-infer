/**
 * The POST /local-infer/provider-delete route: it removes the stored
 * provider entry named by the body's id, keeps the rest of the list and the
 * active config intact, and re-syncs the service's platform registry so a
 * launch never reads a platform config the user just removed.
 * @module dsh-plugin-local-infer/ui/routes/provider-delete
 */
import { readConfig, writeConfig } from "../config.js";
import { syncPlatformConfigs } from "../ops/engine.js";
import { defineRoute } from "../route.js";
import { buildSummary } from "../viewmodels/summary.js";
/**
 * providerDeleteRoute builds the POST /local-infer/provider-delete route
 * definition the register step holds by an effect.
 */
export function providerDeleteRoute(localInfer) {
    return defineRoute({
        name: 'local-infer-provider-delete',
        path: '/local-infer/provider-delete',
        method: 'POST',
        failStatus: 400,
        tooLargeMessage: 'payload too large',
        run: async ({ body }, res) => {
            const id = typeof body.id === 'string' ? body.id : undefined;
            if (id === undefined) {
                res.json(400, { error: 'the provider id is required' });
                return;
            }
            const stored = readConfig();
            const providers = stored.providers.filter((entry) => entry.id !== id);
            writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
            syncPlatformConfigs(localInfer, stored);
            res.json(200, await buildSummary(localInfer));
        },
    });
}
//# sourceMappingURL=provider-delete.js.map