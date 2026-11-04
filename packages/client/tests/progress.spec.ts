import { describe, expect, it } from 'vitest'
import {
  deriveGetStep,
  parseHfProgress,
  type GetProgressState,
} from '../src/store/progress.ts'

// priorState builds the byte-bar state the no-update chunk tests thread.
function priorState(): GetProgressState {
  return {
    step: 'Downloading x.safetensors',
    percent: 12,
    doneBytes: 5.2e9,
    totalBytes: 43.5e9,
    etaSeconds: 611,
    unit: 'bytes',
  }
}

describe('parseHfProgress (the file-count bar)', () => {
  it('parses the Fetching files bar into counts and the eta tail', () => {
    const state = parseHfProgress(
      'Fetching 102 files: 42%|████▏     | 43/102 [00:01<00:02, 20.5it/s]\n',
      null,
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
    const state = parseHfProgress(
      'Fetching 102 files: 42%|████▏     | 43/102 [00:01<00:02, 20.5it/s]\n',
      null,
    )
    expect(state?.unit).toBe('files')
  })

  it('reads a finished bar with no remaining time as eta 0', () => {
    const state = parseHfProgress(
      'Fetching 102 files: 100%|██████████| 102/102 [00:05<00:00, 20.5it/s]\n',
      null,
    )
    expect(state?.etaSeconds).toBe(0)
    expect(state?.percent).toBe(100)
  })

  it('reads a bar without a tail as eta 0', () => {
    const state = parseHfProgress('Fetching 102 files: 42%|▏| 43/102', null)
    expect(state?.etaSeconds).toBe(0)
  })
})

describe('parseHfProgress (the byte bar)', () => {
  it('parses the Downloading bar with human byte sizes and the eta tail', () => {
    const state = parseHfProgress(
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n',
      null,
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
    const state = parseHfProgress(
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\n',
      null,
    )
    expect(state?.unit).toBe('bytes')
  })

  it('converts the human byte sizes with the decimal base', () => {
    const state = parseHfProgress(
      'Downloading x.bin: 50% | 500M/1G [00:01<00:01, 500MB/s]\n',
      null,
    )
    expect(state?.doneBytes).toBe(500e6)
    expect(state?.totalBytes).toBe(1e9)
  })

  it('converts the binary sizes with the 1024 base when the unit carries i', () => {
    const state = parseHfProgress(
      'Downloading x.bin: 50% | 512Mi/1Gi [00:01<00:01, 512MiB/s]\n',
      null,
    )
    expect(state?.doneBytes).toBe(512 * 1024 ** 2)
    expect(state?.totalBytes).toBe(1024 ** 3)
  })

  it('reads a plain byte count with no unit', () => {
    const state = parseHfProgress(
      'Downloading x.bin: 10% | 100/1000 [00:00<00:01, 100B/s]\n',
      null,
    )
    expect(state?.doneBytes).toBe(100)
    expect(state?.totalBytes).toBe(1000)
  })

  it('reads a multi-hour remaining time', () => {
    const state = parseHfProgress(
      'Downloading x.safetensors: 1% | 1G/100G [00:30<1:32:00, 11MB/s]\n',
      null,
    )
    expect(state?.etaSeconds).toBe(1 * 3600 + 32 * 60)
  })
})

describe('parseHfProgress (the chunk fold)', () => {
  it('folds a chunk of carriage-return-separated redraws to the last update', () => {
    const chunk =
      'Downloading x.safetensors: 10% | 4.3G/43.5G [01:00<09:00, 72.3MB/s]\r' +
      'Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]\r'
    const state = parseHfProgress(chunk, null)
    expect(state).toEqual({
      step: 'Downloading x.safetensors',
      percent: 12,
      doneBytes: 5.2e9,
      totalBytes: 43.5e9,
      etaSeconds: 611,
      unit: 'bytes',
    })
  })

  it('threads the fold across chunks, so a later update wins', () => {
    const first = parseHfProgress(
      'Fetching 102 files: 40%|▏| 40/102 [00:01<00:02, 20.5it/s]\n',
      null,
    )
    const second = parseHfProgress(
      'Fetching 102 files: 42%|▏| 43/102 [00:02<00:03, 20.5it/s]\n',
      first,
    )
    expect(second?.doneBytes).toBe(43)
    expect(second?.percent).toBe(42)
  })

  it('keeps the last complete update when a line splits across chunks', () => {
    // The chunk boundary lands mid-line: the partial tail (a percent with
    // no done/total pair) parses to no bar, so the fold keeps the last
    // complete update, and the completed remainder (no verb prefix) parses
    // to no bar on its own.
    const first = parseHfProgress(
      'Fetching 102 files: 40%|▏| 40/102 [00:01<00:02, 20.5it/s]\rFetching 102 files: 4',
      null,
    )
    expect(first?.percent).toBe(40)
    const second = parseHfProgress('2%|▏| 43/102 [00:02<00:03, 20.5it/s]\n', first)
    expect(second).toEqual(first)
  })

  it('returns the prior state when the chunk carries no bar update', () => {
    const prior = priorState()
    expect(parseHfProgress('plain log line\n', prior)).toEqual(prior)
    expect(parseHfProgress('$ hf download org/repo model.bin\n', prior)).toBe(prior)
    expect(parseHfProgress('', null)).toBeNull()
  })

  it('lets a later bar update replace the prior state', () => {
    const state = parseHfProgress(
      'Downloading x.safetensors: 20% | 8.7G/43.5G [02:00<08:00, 72.3MB/s]\n',
      priorState(),
    )
    expect(state?.percent).toBe(20)
    expect(state?.doneBytes).toBe(8.7e9)
  })
})

describe('deriveGetStep', () => {
  it('maps the system dependencies header to deps', () => {
    expect(deriveGetStep('system dependencies (source)\n')).toBe('deps')
  })

  it('maps the model download header to model', () => {
    expect(
      deriveGetStep('model download: org/repo is already present, skipped\n'),
    ).toBe('model')
  })

  it('maps the chat template header to template', () => {
    expect(
      deriveGetStep('chat template: org/repo is already present, skipped\n'),
    ).toBe('template')
  })

  it('maps the get complete header to done', () => {
    expect(deriveGetStep('get complete\n')).toBe('done')
  })

  it('reads the last recognized header in a full run log', () => {
    const log =
      'get ninfer in /models/ninfer\n' +
      'system dependencies (source)\n' +
      '  git: satisfied\n' +
      'model download: org/repo\n' +
      'Fetching 102 files: 42%|▏| 43/102\n' +
      'chat template: org/repo\n' +
      'get complete\n'
    expect(deriveGetStep(log)).toBe('done')
  })

  it('reads the model step before the template header lands', () => {
    const log =
      'system dependencies (source)\n' +
      'model download: org/repo\n' +
      'Fetching 102 files: 42%|▏| 43/102\n'
    expect(deriveGetStep(log)).toBe('model')
  })

  it('returns null when the log carries no step header', () => {
    expect(deriveGetStep('')).toBeNull()
    expect(deriveGetStep('$ hf download org/repo model.bin\n')).toBeNull()
  })
})
