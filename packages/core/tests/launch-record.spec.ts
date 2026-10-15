import { describe, expect, it } from 'vitest'
import {
  commandMatchesArgv,
  launchRecordFromPlan,
  reLinkRecord,
} from '../src/index.ts'
import type { ProviderLaunchRecord } from '../src/index.ts'

function record(overrides: Partial<ProviderLaunchRecord> = {}): ProviderLaunchRecord {
  const base: ProviderLaunchRecord = {
    pid: 12345,
    startedAt: '2026-10-14T12:00:00.000Z',
    argv: ['ninfer-serve', '/models/m.ninfer', '--port', '18020'],
    parentPid: 999,
    previousPids: [999],
    engineId: 'ninfer',
    modelId: 'qwen3-27b',
    port: 18020,
  }
  return { ...base, ...overrides } as ProviderLaunchRecord
}

const COMMAND = 'ninfer-serve /models/m.ninfer --host 127.0.0.1 --port 18020'

describe('commandMatchesArgv', () => {
  it('matches a command line that carries every argv token', () => {
    expect(commandMatchesArgv(COMMAND, ['ninfer-serve', '--port', '18020'])).toBe(true)
  })

  it('fails when a token is missing from the command line', () => {
    expect(commandMatchesArgv(COMMAND, ['llama-server', '--port', '18020'])).toBe(false)
  })

  it('reads an empty argv as a match, not a mismatch', () => {
    expect(commandMatchesArgv('anything at all', [])).toBe(true)
  })
})

describe('reLinkRecord', () => {
  const alive = (pids: number[]) => (pid: number) => pids.includes(pid)
  const cmdline = (map: Record<number, string>) => (pid: number) => map[pid]

  it('adopts an engine the current DSH pid launched', () => {
    const r = record({ parentPid: 500, previousPids: [500] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345, 500]),
        commandLine: cmdline({ 12345: COMMAND }),
      }),
    ).toBe('adopted')
  })

  it('adopts an engine a previous DSH pid launched when that pid is no longer running', () => {
    const r = record({ parentPid: 999, previousPids: [888, 999] })
    // The engine (12345) is alive; the parent 999 is not in the alive set.
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345]),
        commandLine: cmdline({ 12345: COMMAND }),
      }),
    ).toBe('adopted')
  })

  it('reads a previous parent pid that is still running as foreign (a live DSH clone owns it)', () => {
    const r = record({ parentPid: 999, previousPids: [888, 999] })
    // The parent 999 is still alive: a DSH clone owns the engine, so no adopt.
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345, 999]),
        commandLine: cmdline({ 12345: COMMAND }),
      }),
    ).toBe('foreign')
  })

  it('reads a parent pid no list names as foreign (a user-launched engine)', () => {
    const r = record({ parentPid: 4242, previousPids: [999] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345, 4242]),
        commandLine: cmdline({ 12345: COMMAND }),
      }),
    ).toBe('foreign')
  })

  it('reads a dead engine pid as dead, so the record is cleared', () => {
    const r = record({ parentPid: 500, previousPids: [500] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([]),
        commandLine: cmdline({}),
      }),
    ).toBe('dead')
  })

  it('reads a recycled pid (alive but a different command line) as foreign', () => {
    const r = record({ parentPid: 500, previousPids: [500] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345]),
        commandLine: cmdline({ 12345: 'vim PLAN.md' }),
      }),
    ).toBe('foreign')
  })

  it('degrades an unreadable command line to a match, not a mismatch', () => {
    const r = record({ parentPid: 500, previousPids: [500] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345]),
        commandLine: cmdline({}),
      }),
    ).toBe('adopted')
  })

  it('reads a record with no parent pid as foreign (a non-DSH host never claims it)', () => {
    const r = record({ parentPid: undefined, previousPids: [] })
    expect(
      reLinkRecord({
        record: r,
        currentDshPid: 500,
        processAlive: alive([12345]),
        commandLine: cmdline({ 12345: COMMAND }),
      }),
    ).toBe('foreign')
  })
})

describe('launchRecordFromPlan', () => {
  it('builds the record from the plan, the pid, and the parent pid', () => {
    const plan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve', '/models/m.ninfer', '--port', '18020'],
      modelId: 'qwen3-27b',
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const r = launchRecordFromPlan(plan, 12345, 500, [111, 222])
    expect(r.pid).toBe(12345)
    expect(r.argv).toEqual(['ninfer-serve', '/models/m.ninfer', '--port', '18020'])
    expect(r.parentPid).toBe(500)
    expect(r.previousPids).toEqual([111, 222, 500])
    expect(r.engineId).toBe('ninfer')
    expect(r.modelId).toBe('qwen3-27b')
    expect(r.port).toBe(18020)
    expect(typeof r.startedAt).toBe('string')
  })

  it('adds no previous pid when the parent did not identify as DSH', () => {
    const plan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve'],
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const r = launchRecordFromPlan(plan, 12345, undefined, [111])
    expect(r.parentPid).toBeUndefined()
    expect(r.previousPids).toEqual([111])
  })

  it('caps the previous-pid list at the last eight entries', () => {
    const plan = {
      engineId: 'ninfer',
      kind: 'process',
      argv: ['ninfer-serve'],
      port: 18020,
      healthUrl: 'http://127.0.0.1:18020/health',
    }
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const r = launchRecordFromPlan(plan, 12345, 500, many)
    // The cap keeps the list bounded: the last eight of the eleven pids.
    expect(r.previousPids).toEqual([4, 5, 6, 7, 8, 9, 10, 500])
  })
})
