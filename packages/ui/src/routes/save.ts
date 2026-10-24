/**
 * The POST /local-infer/save route: it upserts a provider entry (an id
 * updates the stored entry in place, an absent id mints a new id and
 * prepends the entry), persists the global fields the card's toggles edit,
 * re-syncs the service's platform registry with the saved map, and re-runs
 * the registration for an already-registered model so its input types stay
 * in step with the saved config.
 * @module dsh-plugin-local-infer/ui/routes/save
 */

import type { Config } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import type { LocalInferRoute, StoredProviderConfig } from '../route.ts'
import {
  buildSummary,
  parsePlatformConfigs,
  readConfig,
  readJsonBody,
  requireMethod,
  RouteError,
  sendJson,
  syncPlatformConfigs,
  syncRegisteredModel,
  writeConfig,
} from '../route.ts'

/**
 * newProviderId mints the stable id a new provider entry carries: a
 * timestamp base plus a random tail, so two Saves in the same tick never
 * collide. The card edits and deletes against this id.
 */
function newProviderId(): string {
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * saveRoute builds the POST /local-infer/save route definition the register
 * step holds by an effect.
 */
export function saveRoute(localInfer: LocalInferService): LocalInferRoute {
  return {
    name: 'local-infer-save',
    kind: 'exact',
    path: '/local-infer/save',
    handler: async (req, res) => {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const body = await readJsonBody(req, 'config payload too large')
        const engine = typeof body.engine === 'string' ? body.engine : 'ninfer'
        const config = body.config && typeof body.config === 'object' ? (body.config as Config) : {}
        const allowRunDeps = typeof body.allowRunDeps === 'boolean' ? body.allowRunDeps : false
        const platform = parsePlatformConfigs(body.platform)
        // A body that predates the key keeps the descriptions visible.
        const showHelp = typeof body.showHelp === 'boolean' ? body.showHelp : true
        const providerId =
          typeof body.id === 'string' && body.id.trim() !== '' ? body.id : undefined
        const stored = readConfig()
        // A body that omits the log location (or sends a blank one) keeps the
        // stored template, so an unsaved edit never wipes a custom path.
        const logPath =
          typeof body.logPath === 'string' && body.logPath !== '' ? body.logPath : stored.logPath
        // Save upserts a provider entry: an id updates the stored entry in
        // place, an absent id mints a new id and prepends the entry, so a Save
        // always adds (or refreshes) a card entry at the top of the list. The
        // provider's platform config is the per-engine entry the deploy step
        // reads, so a provider never carries a field it cannot price. A save
        // that updates an entry in place carries the entry's launch record
        // over, so editing a running provider's config never drops the record
        // the restart re-link prices. A settings-only save skips the upsert:
        // it persists the global fields the toggle edits and keeps the stored
        // list intact, so the help and allow-run toggles never mint a
        // duplicate entry.
        let providers: StoredProviderConfig[]
        if (body.settingsOnly === true) {
          providers = stored.providers
        } else {
          const provider: StoredProviderConfig = {
            id: providerId ?? newProviderId(),
            engine,
            config,
            platform: platform[engine] ?? {},
          }
          if (providerId !== undefined) {
            const existing = stored.providers.find((entry) => entry.id === providerId)
            if (existing?.launch !== undefined) {
              provider.launch = existing.launch
            }
          }
          providers =
            providerId !== undefined
              ? stored.providers.map((entry) => (entry.id === providerId ? provider : entry))
              : [provider, ...stored.providers]
        }
        writeConfig(engine, config, allowRunDeps, platform, showHelp, providers, logPath)
        // Re-sync the service registry with the saved platform map, so the next
        // launch reads the platform config the user just saved.
        syncPlatformConfigs(localInfer, {
          engine,
          config,
          allowRunDeps,
          platform,
          showHelp,
          providers,
          logPath,
          lastLogs: stored.lastLogs,
        })
        // A Save on an already-registered model re-runs the registration, so
        // the DSH model row's input types (the vision flag) stay in step with
        // the config the user just saved. Best-effort: a profile without the
        // settings seam, or an engine no adapter serves, leaves the save intact.
        try {
          await syncRegisteredModel(localInfer, engine, config)
        } catch {
          // A sync that cannot run is a no-op for the save.
        }
        sendJson(res, 200, await buildSummary(localInfer, { engine, config }))
      } catch (error) {
        if (error instanceof RouteError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 400, { error: String((error as Error)?.message ?? error) })
      }
    },
  }
}
