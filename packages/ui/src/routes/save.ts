/**
 * The POST /local-infer/save route: it upserts a provider entry (an id
 * updates the stored entry in place, an absent id updates a stored entry that
 * already matches the engine, config, and platform in place, and only a save
 * with no match mints a new id and prepends the entry), persists the global
 * fields the card's toggles edit, re-syncs the service's platform registry with
 * the saved map, and re-runs the registration for an already-registered model
 * so its input types stay in step with the saved config.
 * @module dsh-plugin-local-infer/ui/routes/save
 */

import type { Config } from 'dsh-plugin-local-infer/core'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { parsePlatformConfigs, readConfig, writeConfig } from '../config.ts'
import type { StoredProviderConfig } from '../config.ts'
import { syncPlatformConfigs } from '../ops/engine.ts'
import { syncRegisteredModel } from '../ops/model.ts'
import { defineRoute } from '../route.ts'
import type { LocalInferRoute } from '../route.ts'
import { buildSummary } from '../viewmodels/summary.ts'

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
  return defineRoute({
    name: 'local-infer-save',
    path: '/local-infer/save',
    method: 'POST',
    failStatus: 400,
    tooLargeMessage: 'config payload too large',
    run: async ({ body }, res) => {
      const engine = typeof body.engine === 'string' ? body.engine : 'ninfer'
      const config =
        body.config && typeof body.config === 'object' ? (body.config as Config) : {}
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
      // place, an absent id updates a stored entry that already matches the
      // engine, config, and platform in place, and only a save with no match
      // mints a new id and prepends the entry, so a Save always adds (or
      // refreshes) a card entry at the top of the list without duplicating a
      // provider that is already stored. The provider's platform config is the
      // per-engine entry the deploy step reads, so a provider never carries a
      // field it cannot price. A save that updates an entry in place carries
      // the entry's launch record over, so editing a running provider's config
      // never drops the record the restart re-link prices. A settings-only
      // save skips the upsert: it persists the global fields the toggle edits
      // and keeps the stored list intact, so the help and allow-run toggles
      // never mint a duplicate entry.
      let providers: StoredProviderConfig[]
      if (body.settingsOnly === true) {
        providers = stored.providers
      } else if (providerId !== undefined) {
        // An id updates the stored entry in place, carrying its launch record
        // over so editing a running provider's config never drops the record
        // the restart re-link prices.
        const existing = stored.providers.find((entry) => entry.id === providerId)
        const provider: StoredProviderConfig = {
          id: providerId,
          engine,
          config,
          platform: platform[engine] ?? {},
        }
        if (existing?.launch !== undefined) {
          provider.launch = existing.launch
        }
        providers = stored.providers.map((entry) => (entry.id === providerId ? provider : entry))
      } else {
        // No id: a "New provider" save. If a stored entry already matches the
        // engine, config, and platform, update it in place (carrying its launch
        // record) instead of minting a duplicate: a "New provider" that restores
        // the cached draft and Saves without a change would otherwise prepend a
        // second copy of the same provider.
        const platformConfig = platform[engine] ?? {}
        const matching = stored.providers.find(
          (entry) =>
            entry.engine === engine &&
            JSON.stringify(entry.config) === JSON.stringify(config) &&
            JSON.stringify(entry.platform) === JSON.stringify(platformConfig),
        )
        if (matching !== undefined) {
          const provider: StoredProviderConfig = {
            id: matching.id,
            engine,
            config,
            platform: platformConfig,
          }
          if (matching.launch !== undefined) {
            provider.launch = matching.launch
          }
          providers = stored.providers.map((entry) => (entry.id === matching.id ? provider : entry))
        } else {
          const provider: StoredProviderConfig = {
            id: newProviderId(),
            engine,
            config,
            platform: platformConfig,
          }
          providers = [provider, ...stored.providers]
        }
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
      res.json(200, await buildSummary(localInfer, { engine, config }))
    },
  })
}
