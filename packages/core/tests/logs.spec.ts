import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOG_PATH_TEMPLATE,
  formatLogTimestamp,
  resolveLogPath,
  slugifyModelName,
} from '../src/index.ts'

describe('slugifyModelName', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(slugifyModelName('Qwen3.8-27B')).toBe('qwen3-8-27b')
    expect(slugifyModelName('My Model v2')).toBe('my-model-v2')
  })

  it('truncates to the max length without a trailing hyphen', () => {
    expect(slugifyModelName('a-very-long-model-name-that-goes-on', 8)).toBe('a-very-l')
  })

  it('reads a blank name as "model"', () => {
    expect(slugifyModelName('')).toBe('model')
    expect(slugifyModelName(undefined)).toBe('model')
  })
})

describe('formatLogTimestamp', () => {
  it('renders YYMMDDHHMMSS### zero-padded', () => {
    // 2026-10-14T09:05:07.042Z in a fixed offset the test controls.
    const date = new Date(2026, 9, 14, 9, 5, 7, 42)
    expect(formatLogTimestamp(date)).toBe('261014090507042')
  })
})

describe('resolveLogPath', () => {
  it('fills every placeholder in the default template', () => {
    const date = new Date(2026, 9, 14, 9, 5, 7, 42)
    const path = resolveLogPath(
      DEFAULT_LOG_PATH_TEMPLATE,
      'ninfer',
      'Qwen3.8-27B',
      date,
      '/home/user',
    )
    expect(path).toBe(join('/home/user/.dsh/local-infer/logs', 'ninfer-qwen3-8-27b-261014090507042.log'))
  })

  it('resolves a literal log directory, naming the file from the template', () => {
    const path = resolveLogPath(
      '${HOME}/logs',
      'ninfer',
      'qwen3-8-27b',
      new Date(2026, 9, 14, 9, 5, 7, 42),
      '/home/user',
    )
    expect(path).toBe(join('/home/user/logs', 'ninfer-qwen3-8-27b-261014090507042.log'))
  })

  it('does not double a trailing separator on the log directory', () => {
    const path = resolveLogPath(
      '/home/user/logs/',
      'ninfer',
      'qwen3-8-27b',
      new Date(2026, 9, 14, 9, 5, 7, 42),
      '/home/user',
    )
    expect(path).toBe(join('/home/user/logs/', 'ninfer-qwen3-8-27b-261014090507042.log'))
  })
})
