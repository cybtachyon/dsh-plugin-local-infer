import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createDshDebugLogger,
  createFileDebugLogger,
  isDshDebugMode,
} from '../src/debug.ts'

let tempHome: string
// The HARNESS_LOG_LEVEL env var short-circuits isDshDebugMode to true, so the
// context-level tests unset it for the duration of the suite and restore it
// after, keeping the env-var path out of the context-signal assertions.
let savedHarnessLogLevel: string | undefined

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'local-infer-debug-'))
  savedHarnessLogLevel = process.env.HARNESS_LOG_LEVEL
  delete process.env.HARNESS_LOG_LEVEL
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
  if (savedHarnessLogLevel === undefined) {
    delete process.env.HARNESS_LOG_LEVEL
  } else {
    process.env.HARNESS_LOG_LEVEL = savedHarnessLogLevel
  }
})

describe('isDshDebugMode', () => {
  it('reads a bare context as not-debug', () => {
    const ctx = new Context()
    expect(isDshDebugMode(ctx)).toBe(false)
  })

  it('reads the DSH logger patch (levels.default 3) as debug', () => {
    const ctx = new Context().intercept('logger', { levels: { default: 3 } })
    expect(isDshDebugMode(ctx)).toBe(true)
  })

  it('reads the plain logger level config (level 3) as debug', () => {
    const ctx = new Context().intercept('logger', { level: 3 })
    expect(isDshDebugMode(ctx)).toBe(true)
  })

  it('reads a non-debug logger level as not-debug', () => {
    const ctx = new Context().intercept('logger', { levels: { default: 1 } })
    expect(isDshDebugMode(ctx)).toBe(false)
  })
})

describe('createDshDebugLogger', () => {
  it('returns a no-op logger outside debug mode that never throws', () => {
    const ctx = new Context()
    const logger = createDshDebugLogger(ctx)
    logger('run: cmake --build')
  })

  it('emits through the cordis logger when DSH is in debug mode', () => {
    const seen: string[] = []
    const ctx = new Context().intercept('logger', { levels: { default: 3 } })
    // An exporter at the debug threshold captures the command messages the
    // debug logger emits, mirroring how DSH surfaces debug output.
    ctx.logger.exporter({
      levels: { default: 3 },
      export: (message) => {
        seen.push(String(message.args[0]))
      },
    })
    const logger = createDshDebugLogger(ctx)
    logger('run: cmake --build')
    logger('spawn: ninfer-serve model.ninfer')
    expect(seen).toEqual(['run: cmake --build', 'spawn: ninfer-serve model.ninfer'])
  })
})

describe('createFileDebugLogger', () => {
  it('appends each command to the log file, creating the directory on first write', () => {
    const path = join(tempHome, 'nested', 'commands.log')
    expect(existsSync(path)).toBe(false)
    const logger = createFileDebugLogger(path)
    logger('run: cmake --build')
    logger('spawn: ninfer-serve model.ninfer')
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('run: cmake --build')
    expect(content).toContain('spawn: ninfer-serve model.ninfer')
    // Each line carries an ISO timestamp prefix the reader can sort on.
    expect(content.split('\n')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*run: cmake --build$/)
  })

  it('stays quiet when the directory cannot be created, without throwing', () => {
    // A path under a file (not a directory) cannot host a new directory, so the
    // logger swallows the mkdir failure and never throws on a message.
    const blocker = join(tempHome, 'blocker')
    writeFileSync(blocker, 'a file')
    const logger = createFileDebugLogger(join(blocker, 'sub', 'commands.log'))
    expect(() => logger('run: cmake --build')).not.toThrow()
  })
})
