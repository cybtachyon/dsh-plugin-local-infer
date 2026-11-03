/**
 * The browser card bootstrap: apply, registerCard, and mountCard.
 *
 * dsh web users have no terminal, so the local-inference config (engine,
 * model, parameters) had no way in from the browser. The card is contributed
 * through a slot rather than declared as a settings schema:
 * `plugins.bundle.config`, keyed by the bundle's package name, on the Plugins
 * page from dsh 0.1.6-alpha.2 on, and `settings.plugin.item` on older hosts.
 * It reads and writes the plugin's own route (/local-infer/summary,
 * /local-infer/save), which owns ~/.dsh/local-infer/config.json, so the
 * browser never sees a value it did not store.
 *
 * React and @deepseek-ai/dsh-client-ui-primitives come from the shell's
 * frozen platform module table (PLATFORM_MODULES), the same baseline every
 * dynamic bundle resolves against, so the card draws the DSH selector menus,
 * buttons, checkboxes, and state dots its host Settings pages use. Hosts
 * whose table predates the primitives seed keep the native controls through
 * the require fallback in mountCard.
 * @module dsh-plugin-local-infer/client/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { card, type LocaleRef } from './Card.tsx'
import { routeExists } from './api/routes.ts'
import { setPrimitivesModule, type PrimitivesModule } from './render/primitives.tsx'
import { setReactModule, type ReactLike as StoreReactLike } from './store/useCardStore.ts'

// The require the lazy-CJS factory injects: the shell's frozen platform module
// table. esbuild keeps these calls bare in the CJS output, so inside the
// factory they resolve against the injected require, not node's.
declare const require: (name: string) => unknown

// The minimal react surface the card needs (the classic transform's
// createElement). The full react type is a runtime external, not a compile
// dependency, so the card names only what it calls.
interface ReactLike {
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown
}

// The Plugins page dispatches a bundle's configuration by the bundle's
// manifest name (the root package.json "name" field, unscoped for git-URL
// installs), which is the key the package inventory uses for the
// plugins.bundle.config slot.
const PACKAGE_NAME = 'dsh-plugin-local-infer'

/**
 * The slots service is dsh-specific and absent from the cordis Context type,
 * so the card narrows the scoped context to the members it needs.
 */
export interface SlotsService {
  /** Wait until the named slot is declared, then run the generator body. */
  inject(name: string, body: () => Generator<unknown, void, unknown>): void
  /** Register a component into the named slot; returns the registration handle. */
  register(spec: SlotSpec, component: unknown): unknown
}

/** The slot registration spec: the slot name plus the host-specific keys. */
export interface SlotSpec {
  name: string
  key?: string
  id?: string
  order?: number
}

// The locale scope hands the card the active locale string (or undefined).
type LocaleScope = Context & { locale: string | undefined }
// The slots scope hands the card the slots service.
type SlotsScope = Context & { slots: SlotsService }

/**
 * registerCard wires the card into the host through the two optional seams,
 * each on its own scoped inject so a closure only runs where its service
 * exists. Reaching for an undeclared service throws in cordis, so each
 * optional dependency rides a scoped ctx.inject of its own.
 */
function registerCard(ctx: Context): void {
  if (typeof ctx.inject !== 'function') {
    return
  }

  const localeRef: LocaleRef = { current: null }
  ctx.inject(['locale'], (scope) => {
    localeRef.current = (scope as LocaleScope).locale ?? null
    if (typeof scope.effect === 'function') {
      scope.effect(
        () => () => {
          localeRef.current = null
        },
        'local-infer: locale handle',
      )
    }
  })

  ctx.inject(['slots'], (scope) => {
    // The card and its route live and die together: with the host route
    // absent (no web profile) a card would only render an error, which is
    // not what a headless profile means. The probe reads any response at
    // all as proof the route exists; only a 404 or a network failure reads
    // as absent.
    routeExists().then((exists) => {
      if (!exists) {
        return
      }
      try {
        mountCard(scope as SlotsScope, localeRef)
      } catch (error) {
        console.error(`[local-infer] settings card skipped: ${error}`)
      }
    })
  })
}

/**
 * mountCard resolves the two runtime externals (react always, the primitives
 * seed with a native-control fallback) and registers the card into both
 * slots. A missing primitives seed is a fallback, not an error, so the card
 * still renders.
 */
function mountCard(ctx: SlotsScope, localeRef: LocaleRef): void {
  let react: unknown
  try {
    react = require('react')
  } catch (error) {
    console.error(`[local-infer] settings card skipped: ${error}`)
    return
  }
  // The store binding (useCardStore) reads react through this seam, so the
  // bundle keeps its two runtime require calls here and a react-absent host
  // skips the card above, not at module load.
  setReactModule(react as StoreReactLike)
  // The shell seeds the primitives into the frozen platform module table,
  // so the require resolves on every host that serves this page. A host
  // whose table predates the seed (or a loader that cannot materialize
  // it) keeps the native controls: a missing seed is a fallback, not an
  // error, so the card still renders.
  let primitives: PrimitivesModule | null
  try {
    primitives = require('@deepseek-ai/dsh-client-ui-primitives') as PrimitivesModule
  } catch {
    primitives = null
  }
  if (primitives && typeof primitives.Menu !== 'function') {
    primitives = null
  }
  // The renderers draw the seed when present and the native controls when it
  // is absent, so the resolved value (or null) is handed to them here.
  setPrimitivesModule(primitives)
  const Card = card(react as ReactLike, localeRef, primitives)
  // slots.inject waits until a slot is declared, so each host fills the one
  // it has and the other wait never fires: from dsh 0.1.6-alpha.2 on hosts
  // declare the Plugins page's, older ones only the Settings one.
  ctx.slots.inject('plugins.bundle.config', function* () {
    yield ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card)
  })
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      { name: 'settings.plugin.item', id: 'local-infer', key: 'local-infer', order: 41 },
      Card,
    )
  })
}

/**
 * apply is the plugin entry point: it wires the card into the host. `slots`
 * and `locale` are both optional, so neither is required here; registerCard
 * takes each on its own scoped inject.
 */
export function apply(ctx: Context): void {
  registerCard(ctx)
}
