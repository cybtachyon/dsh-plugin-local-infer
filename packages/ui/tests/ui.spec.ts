import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalInfer from 'dsh-plugin-local-infer/service'
import localInferUi, { apply, inject, name } from '../src/index.ts'
import type { WebServerService } from '../src/route.ts'

describe('local-infer-ui scaffold', () => {
  it('exposes the object-plugin shape the loader and ctx.plugin both accept', () => {
    expect(name).toBe('local-infer-ui')
    expect(inject).toEqual(['localInfer'])
    expect(localInferUi).toEqual({ name, inject, apply })
  })

  it('loads alongside the service without mounting any UI', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    await ctx.plugin(localInferUi)
    expect(ctx.localInfer).toBeInstanceOf(LocalInfer)
  })

  it('registers the settings route only where a webServer is injected', async () => {
    // A context whose inject hands the callback a scope carrying a webServer
    // mounts the route; a bare context (no inject) mounts nothing. The
    // service plugin is awaited, so ctx.localInfer is set before apply runs
    // (the route's platform sync reads it), not a promise still resolving.
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    const registered: { path: string }[] = []
    const webServer = {
      register(route: { path: string; handler: unknown }): () => void {
        registered.push(route)
        return () => {
          /* the effect disposer unregisters; the test owns the list */
        }
      },
    }
    const scope = {
      webServer,
      effect(fn: () => unknown): void {
        fn()
      },
    }
    ;(ctx as unknown as { inject: (names: string[], cb: (scope: unknown) => void) => void }).inject = (
      _names,
      cb,
    ) => {
      cb(scope)
    }
    apply(ctx)
    expect(registered.length).toBeGreaterThan(0)
    expect(registered[0]?.path).toBe('/local-infer/summary')
  })

  it('swallows a route-registration failure so the panel still loads', () => {
    const ctx = new Context()
    void ctx.plugin(LocalInfer)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      /* the apply catch logs and continues */
    })
    // A webServer whose register throws makes registerLocalInferRoute throw,
    // so the apply catch logs the failure rather than surfacing it.
    const scope = {
      webServer: {
        register: (): void => {
          throw new Error('webServer unavailable')
        },
      } satisfies WebServerService,
      effect(fn: () => unknown): void {
        fn()
      },
    }
    ;(ctx as unknown as { inject: (names: string[], cb: (scope: unknown) => void) => void }).inject = (
      _names,
      cb,
    ) => {
      cb(scope)
    }
    apply(ctx)
    expect(error).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('settings route skipped'))
    error.mockRestore()
  })
})
