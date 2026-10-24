/**
 * The plugin bootstrap guard. The host loads the ui entry from the package
 * path (a profile install symlinks the repo), so the emitted lib/ JS must
 * resolve every import from that location: a value import of a bare
 * dsh-plugin-local-infer/* specifier (a self-reference that only resolves
 * inside a node_modules tree) fails the whole entry with
 * ERR_MODULE_NOT_FOUND, and the plugin logs "1 entry did not activate".
 * These tests keep that from recurring: a source scan bans the bare
 * value import, a node spawn loads the built entry through the real ESM
 * loader (the restart scenario), and a wiring pass runs apply with a stub
 * context and asserts every route registers.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import type { Context } from '@deepseek-ai/cordis'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const uiLibEntry = join(repoRoot, 'packages/ui/lib/index.js')

/**
 * ensureBuilt runs an incremental tsc -b when the ui lib/ is absent, so the
 * bootstrap tests work on a fresh checkout where pnpm build has not run yet.
 */
function ensureBuilt(): void {
  if (existsSync(uiLibEntry)) return
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '-b', repoRoot], { stdio: 'inherit' })
}

beforeAll(ensureBuilt)

describe('ui source import rules', () => {
  it('never value-imports a bare dsh-plugin-local-infer specifier', () => {
    // A value import of the root package subpath survives into the emitted
    // lib/ JS and breaks the repo-path (symlinked profile) install, where the
    // bare specifier has no node_modules self-link to resolve against. Type
    // imports are erased at compile time and may use the bare specifier.
    const offenders: string[] = []
    for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
      const srcDir = join(repoRoot, 'packages', pkg, 'src')
      if (!existsSync(srcDir)) continue
      for (const file of listSourceFiles(srcDir)) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.ES2022,
          true,
        )
        for (const stmt of source.statements) {
          if (!ts.isImportDeclaration(stmt)) continue
          const spec = stmt.moduleSpecifier
          if (!ts.isStringLiteral(spec) || !spec.text.startsWith('dsh-plugin-local-infer')) {
            continue
          }
          const clause = stmt.importClause
          let typeOnly = clause?.isTypeOnly === true
          const bindings = clause?.namedBindings
          if (!typeOnly && bindings !== undefined && ts.isNamedImports(bindings)) {
            typeOnly = bindings.elements.every((element) => element.isTypeOnly)
          }
          if (typeOnly) continue
          offenders.push(`${file} -> ${spec.text}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('ui entry bootstrap', () => {
  it('node loads the built entry from the repo path (the restart scenario)', () => {
    // The real ESM loader with real resolution: a bare-specifier value import
    // in the emitted chain throws ERR_MODULE_NOT_FOUND exactly as the host
    // restart warning does.
    const entry = pathToFileURL(uiLibEntry).href
    const script = `import(${JSON.stringify(entry)}).then((m) => {
  if (typeof m.apply !== 'function') throw new Error('the ui entry has no apply')
}, (e) => { console.error(e); process.exit(1) })`
    execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  })

  it('apply bootstraps the plugin: all 12 routes register and dispose', async () => {
    const mod = await import('../lib/index.js')
    expect(mod.name).toBe('local-infer-ui')
    expect(mod.inject).toEqual(['localInfer'])
    const registered: string[] = []
    let disposed = 0
    // The stub carries only what the route effect touches: the platform-
    // config registry sync, the death observer, and the re-link. readConfig
    // reads the real ~/.dsh config, so a machine with stored providers still
    // boots through the reLinkProviders no-op.
    const stubService = {
      registerEnginePlatformConfig: (): (() => void) => () => undefined,
      setEngineDeathObserver: (): void => undefined,
      reLinkProviders: async (): Promise<Record<string, string>> => ({}),
    }
    const ctx = {
      localInfer: stubService,
      inject: (_names: string[], fn: (scope: unknown) => void): void => {
        fn({
          webServer: {
            register: (route: { path: string }): (() => void) => {
              registered.push(route.path)
              return () => {
                disposed += 1
              }
            },
          },
          effect: (fn: () => void | (() => void)): void => {
            const dispose = fn()
            if (typeof dispose === 'function') {
              dispose()
            }
          },
        })
      },
    }
    mod.apply(ctx as unknown as Context)
    expect(registered).toEqual([
      '/local-infer/summary',
      '/local-infer/save',
      '/local-infer/provider-delete',
      '/local-infer/deps',
      '/local-infer/install',
      '/local-infer/download',
      '/local-infer/chat-template',
      '/local-infer/get',
      '/local-infer/launch',
      '/local-infer/stop',
      '/local-infer/register',
      '/local-infer/unregister',
    ])
    // The effect disposer unregisters every route it registered.
    expect(disposed).toBe(12)
  })
})

/**
 * listSourceFiles lists every .ts file under a directory, recursively.
 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}
