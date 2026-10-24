/**
 * The POST /local-infer/provider-delete route: it removes the stored
 * provider entry named by the body's id, keeps the rest of the list and the
 * active config intact, and re-syncs the service's platform registry so a
 * launch never reads a platform config the user just removed.
 * @module dsh-plugin-local-infer/ui/routes/provider-delete
 */
import { buildSummary, readConfig, readJsonBody, requireMethod, RouteError, sendJson, syncPlatformConfigs, writeConfig, } from "../route.js";
/**
 * providerDeleteRoute builds the POST /local-infer/provider-delete route
 * definition the register step holds by an effect.
 */
export function providerDeleteRoute(localInfer) {
    return {
        name: 'local-infer-provider-delete',
        kind: 'exact',
        path: '/local-infer/provider-delete',
        handler: async (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            try {
                const body = await readJsonBody(req, 'payload too large');
                const id = typeof body.id === 'string' ? body.id : undefined;
                if (id === undefined) {
                    sendJson(res, 400, { error: 'the provider id is required' });
                    return;
                }
                const stored = readConfig();
                const providers = stored.providers.filter((entry) => entry.id !== id);
                writeConfig(stored.engine, stored.config, stored.allowRunDeps, stored.platform, stored.showHelp, providers, stored.logPath, stored.lastLogs);
                syncPlatformConfigs(localInfer, stored);
                sendJson(res, 200, await buildSummary(localInfer));
            }
            catch (error) {
                if (error instanceof RouteError) {
                    sendJson(res, error.status, { error: error.message });
                    return;
                }
                sendJson(res, 400, { error: String(error?.message ?? error) });
            }
        },
    };
}
//# sourceMappingURL=provider-delete.js.map