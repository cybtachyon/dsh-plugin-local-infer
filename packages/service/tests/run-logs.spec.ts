/**
 * The per-provider run-log hub: the five facade operations on ctx.localInfer
 * (beginRun, appendRunLog, readRunLog, subscribeRunLog, endRun) with the
 * tail cap, the seq counter every stream event continues, the lazy open, and
 * the subscriber isolation; plus the two pure rules: the runLogKey cascade
 * (providerId, engine-and-model entry, engine id) and the shared
 * findLaunchTarget matcher. No test waits a real clock or opens a real
 * stream: the listeners are plain recorders.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LOG_TAIL_BYTES } from 'dsh-plugin-local-infer/core'
import type { Config } from 'dsh-plugin-local-infer/core'
import LocalInfer from '../src/index.ts'
import type { LaunchTargetEntry, RunLogEvent } from '../src/types.ts'
import { runLogKey } from '../src/run-logs.ts'
import { findLaunchTarget } from '../src/launch-target.ts'

async function seam(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LocalInfer)
  return ctx
}

/** A stored provider entry for the key-rule tests, named by engine and model. */
function storedEntry(id: string, engine: string, model?: string): LaunchTargetEntry {
  return { id, engine, config: model === undefined ? {} : { model } }
}

const STORED: readonly LaunchTargetEntry[] = [
  storedEntry('p-ninfer', 'ninfer', 'qwen3-27b'),
  storedEntry('p-llama', 'llamacpp', 'qwen3-27b'),
  storedEntry('p-strata', 'strata'),
]

describe('run-log hub (ctx.localInfer)', () => {
  it('opens a run lazily on the first append and reads back the snapshot', async () => {
    const ctx = await seam()
    ctx.localInfer.appendRunLog('ninfer', 'one\n')
    ctx.localInfer.appendRunLog('ninfer', 'two\n')
    expect(ctx.localInfer.readRunLog('ninfer')).toEqual({
      seq: 2,
      text: 'one\ntwo\n',
      running: true,
    })
  })

  it('reads an empty stopped snapshot for a key that never ran', async () => {
    const ctx = await seam()
    expect(ctx.localInfer.readRunLog('nobody')).toEqual({ seq: 0, text: '', running: false })
  })

  it('caps the buffered tail at LOG_TAIL_BYTES, keeping the newest text', async () => {
    const ctx = await seam()
    ctx.localInfer.appendRunLog('chatty', 'a'.repeat(LOG_TAIL_BYTES + 500))
    ctx.localInfer.appendRunLog('chatty', 'TAIL\n')
    const snapshot = ctx.localInfer.readRunLog('chatty')
    expect(snapshot.text).toHaveLength(LOG_TAIL_BYTES)
    expect(snapshot.text.endsWith('TAIL\n')).toBe(true)
    expect(snapshot.text.startsWith('a')).toBe(true)
  })

  it('begin resets the text and the seq and notifies subscribers with the seed', async () => {
    const ctx = await seam()
    const events: RunLogEvent[] = []
    ctx.localInfer.subscribeRunLog('ninfer', (event) => events.push(event))
    ctx.localInfer.beginRun('ninfer', '--- Launching...\n')
    ctx.localInfer.appendRunLog('ninfer', 'line\n')
    ctx.localInfer.beginRun('ninfer', '--- Getting...\n')
    expect(events).toEqual([
      { kind: 'reset', seq: 0, text: '--- Launching...\n' },
      { kind: 'log', seq: 1, text: 'line\n' },
      { kind: 'reset', seq: 0, text: '--- Getting...\n' },
    ])
    expect(ctx.localInfer.readRunLog('ninfer')).toEqual({
      seq: 0,
      text: '--- Getting...\n',
      running: true,
    })
  })

  it('streams the appends and the end event and clears the running flag', async () => {
    const ctx = await seam()
    const events: RunLogEvent[] = []
    ctx.localInfer.subscribeRunLog('ninfer', (event) => events.push(event))
    ctx.localInfer.beginRun('ninfer', '--- Launching...\n')
    ctx.localInfer.appendRunLog('ninfer', 'build\n')
    ctx.localInfer.appendRunLog('ninfer', 'serve\n')
    ctx.localInfer.endRun('ninfer')
    expect(events.map((event) => event.kind)).toEqual(['reset', 'log', 'log', 'end'])
    expect(events[3]).toEqual({ kind: 'end', seq: 2 })
    expect(ctx.localInfer.readRunLog('ninfer')).toEqual({
      seq: 2,
      text: '--- Launching...\nbuild\nserve\n',
      running: false,
    })
  })

  it('delivers nothing to a removed subscriber and keeps the rest subscribed', async () => {
    const ctx = await seam()
    const first: RunLogEvent[] = []
    const second: RunLogEvent[] = []
    const disposeFirst = ctx.localInfer.subscribeRunLog('k', (event) => first.push(event))
    ctx.localInfer.subscribeRunLog('k', (event) => second.push(event))
    ctx.localInfer.appendRunLog('k', 'a')
    disposeFirst()
    ctx.localInfer.appendRunLog('k', 'b')
    expect(first.map((event) => event.text)).toEqual(['a'])
    expect(second.map((event) => event.text)).toEqual(['a', 'b'])
  })

  it('isolates a throwing subscriber from the writer and the other subscribers', async () => {
    const ctx = await seam()
    ctx.localInfer.beginRun('k', '')
    const seen: RunLogEvent[] = []
    ctx.localInfer.subscribeRunLog('k', () => {
      throw new Error('broken connection')
    })
    ctx.localInfer.subscribeRunLog('k', (event) => seen.push(event))
    expect(() => ctx.localInfer.appendRunLog('k', 'x\n')).not.toThrow()
    ctx.localInfer.endRun('k')
    expect(seen.map((event) => event.kind)).toEqual(['log', 'end'])
    expect(ctx.localInfer.readRunLog('k').text).toBe('x\n')
  })

  it('keeps an ended run readable and reopens it without a seed on a late append', async () => {
    const ctx = await seam()
    ctx.localInfer.beginRun('ninfer', '--- Launching...\n')
    ctx.localInfer.appendRunLog('ninfer', 'serve\n')
    ctx.localInfer.endRun('ninfer')
    const events: RunLogEvent[] = []
    ctx.localInfer.subscribeRunLog('ninfer', (event) => events.push(event))
    ctx.localInfer.appendRunLog('ninfer', '[local-infer] engine exited\n')
    // The late note streams as a plain append (no reset: the reader's text
    // is still the run's tail), and the run reopens until its next end.
    expect(events).toEqual([
      { kind: 'log', seq: 2, text: '[local-infer] engine exited\n' },
    ])
    expect(ctx.localInfer.readRunLog('ninfer')).toEqual({
      seq: 2,
      text: '--- Launching...\nserve\n[local-infer] engine exited\n',
      running: true,
    })
  })

  it('ends quietly for a key with no open run and never emits a second end', async () => {
    const ctx = await seam()
    const events: RunLogEvent[] = []
    ctx.localInfer.subscribeRunLog('ghost', (event) => events.push(event))
    ctx.localInfer.endRun('ghost')
    expect(events).toEqual([])
    expect(ctx.localInfer.readRunLog('ghost')).toEqual({ seq: 0, text: '', running: false })
    ctx.localInfer.beginRun('ghost', 'seed')
    ctx.localInfer.endRun('ghost')
    ctx.localInfer.endRun('ghost')
    expect(events.map((event) => event.kind)).toEqual(['reset', 'end'])
  })
})

describe('runLogKey', () => {
  it('keys on the request providerId when it names one', () => {
    expect(runLogKey(STORED, 'ninfer', 'p-llama', { model: 'qwen3-27b' })).toBe('p-llama')
    // A named id is the key even when no stored entry carries it, so the
    // key never depends on the store the client cannot see.
    expect(runLogKey(STORED, 'ninfer', 'p-fresh', {})).toBe('p-fresh')
  })

  it('falls back to the stored entry matched by engine and model', () => {
    expect(runLogKey(STORED, 'llamacpp', undefined, { model: 'qwen3-27b' })).toBe('p-llama')
    // A blank id is not a name; the engine-and-model match still applies.
    expect(runLogKey(STORED, 'ninfer', '  ', { model: 'qwen3-27b' })).toBe('p-ninfer')
  })

  it('falls back to the engine id when neither names an entry', () => {
    expect(runLogKey(STORED, 'ninfer', undefined, {})).toBe('ninfer')
    expect(runLogKey(STORED, 'hyperqwen', undefined, { model: 'other' })).toBe('hyperqwen')
  })
})

describe('findLaunchTarget', () => {
  it('takes the entry the id names before the engine-and-model match', () => {
    const target = findLaunchTarget(STORED, 'ninfer', 'p-llama', { model: 'qwen3-27b' })
    expect(target?.id).toBe('p-llama')
  })

  it('matches the entry with the same engine and model when no id names one', () => {
    expect(findLaunchTarget(STORED, 'llamacpp', undefined, { model: 'qwen3-27b' })?.id).toBe(
      'p-llama',
    )
    // A named id with no stored entry falls through to the same match.
    expect(findLaunchTarget(STORED, 'llamacpp', 'p-gone', { model: 'qwen3-27b' })?.id).toBe(
      'p-llama',
    )
  })

  it('answers undefined when the model or the engine does not line up', () => {
    const config: Config = { model: 'qwen3-27b' }
    expect(findLaunchTarget(STORED, 'strata', undefined, config)).toBeUndefined()
    expect(findLaunchTarget(STORED, 'ninfer', undefined, {})).toBeUndefined()
    expect(findLaunchTarget([], 'ninfer', undefined, config)).toBeUndefined()
  })
})
