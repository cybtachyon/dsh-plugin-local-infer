import { describe, expect, it } from 'vitest'
import { foldHfProgressChunk, parseHfProgressLine } from '../src/index.ts'

describe('parseHfProgressLine (the file-count bar)', () => {
  it('parses the Fetching files bar into counts and the eta tail', () => {
    const state = parseHfProgressLine(
      'Fetching 102 files: 42%|████▏     | 43/102 [00:01<00:02, 20.5it/s]',
    )
    expect(state).toEqual({
      step: 'Fetching 102 files',
      percent: 42,
      doneBytes: 43,
      totalBytes: 102,
      etaSeconds: 2,
      unit: 'files',
    })
  })

  it('marks the file-count bar amounts as files', () => {
    const state = parseHfProgressLine(
      'Fetching 102 files: 42%|████▏     | 43/102 [00:01<00:02, 20.5it/s]',
    )
    expect(state?.unit).toBe('files')
  })

  it('reads a finished bar with no remaining time as eta 0', () => {
    const state = parseHfProgressLine(
      'Fetching 102 files: 100%|██████████| 102/102 [00:05<00:00, 20.5it/s]',
    )
    expect(state?.etaSeconds).toBe(0)
    expect(state?.percent).toBe(100)
  })

  it('reads a bar without a tail as eta 0', () => {
    const state = parseHfProgressLine('Fetching 102 files: 42%|▏| 43/102')
    expect(state?.etaSeconds).toBe(0)
  })
})

describe('parseHfProgressLine (the byte bar)', () => {
  it('parses the Downloading bar with human byte sizes and the eta tail', () => {
    const state = parseHfProgressLine(
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]',
    )
    expect(state).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
  })

  it('marks the byte bar amounts as bytes', () => {
    const state = parseHfProgressLine(
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]',
    )
    expect(state?.unit).toBe('bytes')
  })

  it('converts the human byte sizes with the decimal base', () => {
    const state = parseHfProgressLine(
      'Downloading x.bin: 50% | 500M/1G [00:01<00:01, 500MB/s]',
    )
    expect(state?.doneBytes).toBe(500e6)
    expect(state?.totalBytes).toBe(1e9)
  })

  it('converts the binary sizes with the 1024 base when the unit carries i', () => {
    const state = parseHfProgressLine(
      'Downloading x.bin: 50% | 512Mi/1Gi [00:01<00:01, 512MiB/s]',
    )
    expect(state?.doneBytes).toBe(512 * 1024 ** 2)
    expect(state?.totalBytes).toBe(1024 ** 3)
  })

  it('reads a plain byte count with no unit', () => {
    const state = parseHfProgressLine('Downloading x.bin: 10% | 100/1000 [00:00<00:01, 100B/s]')
    expect(state?.doneBytes).toBe(100)
    expect(state?.totalBytes).toBe(1000)
  })

  it('reads a multi-hour remaining time', () => {
    const state = parseHfProgressLine(
      'Downloading x.safetensors: 1% | 1G/100G [00:30<1:32:00, 11MB/s]',
    )
    expect(state?.etaSeconds).toBe(1 * 3600 + 32 * 60)
  })
})

describe('parseHfProgressLine (the non-bar lines)', () => {
  it('returns undefined for a plain log line', () => {
    expect(parseHfProgressLine('$ hf download org/repo model.bin --format human')).toBeUndefined()
  })

  it('returns undefined for a blank line', () => {
    expect(parseHfProgressLine('')).toBeUndefined()
    expect(parseHfProgressLine('   ')).toBeUndefined()
  })
})

describe('foldHfProgressChunk', () => {
  it('folds a chunk of carriage-return-separated redraws to the last update', () => {
    const chunk =
      'Downloading x.safetensors: 10% | 4.3G/43.5G [01:00<09:00, 72.3MB/s]\r' +
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\r'
    const state = foldHfProgressChunk(chunk, undefined)
    expect(state).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
  })

  it('returns the prior state when the chunk carries no bar update', () => {
    const prior = {
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    }
    expect(foldHfProgressChunk('plain log line\n', prior)).toEqual(prior)
    expect(foldHfProgressChunk('', undefined)).toBeUndefined()
  })

  it('threads the fold across chunks, so a later update wins', () => {
    const first = foldHfProgressChunk(
      'Fetching 102 files: 40%|▏| 40/102 [00:01<00:02, 20.5it/s]\n',
      undefined,
    )
    const second = foldHfProgressChunk(
      'Fetching 102 files: 42%|▏| 43/102 [00:02<00:03, 20.5it/s]\n',
      first,
    )
    expect(second?.doneBytes).toBe(43)
    expect(second?.percent).toBe(42)
  })
})
