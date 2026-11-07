/**
 * The Web UI for the local-inference capability: the form-type-aware parameter
 * form (checkbox, dropdown, slider, text, picker), the live VRAM Est. meter,
 * the red hardware-warning banner, the register-as-model confirmation (the
 * register and unregister routes the card's DSH model row talks to), and the
 * engine lifecycle controls (build / deploy / stop).
 *
 * The render models (form, meter, warnings) are pure data the panel draws
 * from; Phase 8 wires them into one panel with the lifecycle controls.
 * @module dsh-plugin-local-infer/ui
 */

import type { Context } from '@deepseek-ai/cordis'
import { createNodeLifecycleHost } from '../../providers/lib/index.js'
import { registerLocalInferRoute } from './route.ts'
import type { WebServerService } from './route.ts'

export const name = 'local-infer-ui'
export const inject = ['localInfer']

/**
 * The form-type-aware render model: `renderForm` maps a `ParameterSpec` list
 * and a `Config` to the sections and fields the panel draws. The panel lands
 * in Phase 8; the model is pure data the renderer tests assert on directly.
 */
export {
  GENERAL_GROUP,
  controlFor,
  renderForm,
  resolveValue,
} from './form.ts'
export type {
  FormControl,
  FormFieldModel,
  FormModel,
  FormSectionModel,
} from './form.ts'
export { renderMeter } from './meter.ts'
export type { MeterModel, MeterSegment, UnknownEnginesModel } from './meter.ts'
export { renderDeps } from './deps.ts'
export type { ChatTemplateDepModel, DepItemModel, DepsModel } from './deps.ts'
export { renderWarnings, toneFor } from './warnings.ts'
export type {
  WarningBannerModel,
  WarningModel,
  WarningsModel,
  WarningTone,
} from './warnings.ts'

// The card-facing types the browser card (packages/client) consumes. The
// card imports them with `import type` only, so they are erased at bundle
// time and the card keeps its two runtime externals (react, primitives).
export type { StoredPlatformConfig } from './config.ts'
export type { InstallResponse } from './viewmodels/depsHelpers.ts'
export type {
  ChatTemplateStatusModel,
  LocalInferSummary,
  ProviderSummaryEntry,
} from './viewmodels/summary.ts'
export type { Config, CustomArg, RegisterResult } from 'dsh-plugin-local-infer/core'
export type { DownloadResult, LaunchResult } from 'dsh-plugin-local-infer/service'
// The lines the logs route streams. The client bundle mirrors this union by
// hand in packages/client/src/api/routes.ts (it cannot import the node-side
// ui package), so this export is the one named source the mirror follows;
// the two copies change together by hand.
export type { LogsStreamEvent } from './routes/logs.ts'

/**
 * Mount the Web UI. The browser card (dsh/client.js) registers into the
 * Plugins page's `plugins.bundle.config` slot and talks to the settings route
 * below; the route is registered only where a webServer exists, so a headless
 * profile keeps the service and tools untouched.
 */
export function apply(ctx: Context): void {
  const localInfer = ctx.localInfer
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        // The route host is built here (not the bare node default) so its
        // sudo hook reaches the service: a guarded command whose credential
        // probe found nothing announces through notifySudoNeeded, and the
        // launch run's sudo observer (ops/engine.ts) turns it into the
        // streamed sudo event and the Logs note. The same host drives the
        // Get and launch routes' Get steps.
        const host = createNodeLifecycleHost(undefined, {
          notify: (command) => localInfer.notifySudoNeeded(command),
        })
        registerLocalInferRoute(
          scope as Context & { webServer: WebServerService },
          localInfer,
          host,
          host,
        )
      } catch (error) {
        console.error(`[local-infer] settings route skipped: ${error}`)
      }
    })
  }
}

const plugin = { name, inject, apply }
export default plugin
