/**
 * The shipped-bundle freshness gate. dsh/client.js is generated output
 * (scripts/build-client.mjs esbuild-bundles packages/client/src into the
 * lazy-CJS carrier): a commit that changes the card source without rebuilding
 * ships a stale card, which is exactly how the sudo half nearly shipped
 * unbundled (TASK-009 found the stale dsh/client.js). Freshness compares the
 * bundle's newest signal (a rebuild's working-tree mtime, or the last commit
 * that touched it) against the source's newest signal (the newest src-file
 * mtime, or the last commit that touched src). The bundle side reading
 * behind the source side means: run `pnpm build` and commit dsh/client.js.
 * A rebuild always lifts the bundle mtime, so a comment-only src change
 * clears with the routine rebuild; a fresh checkout passes because the
 * checkout's mtime postdates the newest commit on both sides.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const bundlePath = join(repoRoot, 'dsh', 'client.js')
const srcDir = join(repoRoot, 'packages', 'client', 'src')

/**
 * lastCommitTimeMs answers the commit time (ms) of the newest commit touching
 * path, or 0 when git cannot answer (git absent, path untracked): the fresh-
 * checkout signal, where mtimes are all checkout time and history is the
 * only freshness evidence.
 */
function lastCommitTimeMs(path: string): number {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    return out === '' ? 0 : Number(out) * 1000
  } catch {
    return 0
  }
}

/** newestMtimeMs walks dir and answers the newest file mtime under it. */
function newestMtimeMs(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs)
  }
  return newest
}

describe('dsh/client.js freshness', () => {
  it('the shipped bundle is never older than packages/client/src', () => {
    // Each side reads its two freshness signals: the working tree (a rebuild
    // just ran) and git history (a fresh checkout nobody has built in).
    const bundleFreshMs = Math.max(statSync(bundlePath).mtimeMs, lastCommitTimeMs('dsh/client.js'))
    const sourceFreshMs = Math.max(newestMtimeMs(srcDir), lastCommitTimeMs('packages/client/src'))
    expect(
      bundleFreshMs,
      'dsh/client.js predates packages/client/src: run `pnpm build` and commit the rebuilt bundle',
    ).toBeGreaterThanOrEqual(sourceFreshMs)
  })
})
