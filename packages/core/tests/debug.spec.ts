import { describe, expect, it } from 'vitest'
import {
  NOOP_DEBUG_LOGGER,
  createCommandDebugLogger,
  isHarnessLogDebug,
} from '../src/index.ts'

describe('isHarnessLogDebug', () => {
  it('reads DEBUG (case-insensitive) as debug', () => {
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: 'DEBUG' })).toBe(true)
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: 'debug' })).toBe(true)
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: ' Debug ' })).toBe(true)
  })

  it('reads the numeric level 3 as debug', () => {
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: '3' })).toBe(true)
  })

  it('reads other values and an absent variable as off', () => {
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: 'INFO' })).toBe(false)
    expect(isHarnessLogDebug({ HARNESS_LOG_LEVEL: '1' })).toBe(false)
    expect(isHarnessLogDebug({})).toBe(false)
  })
})

describe('createCommandDebugLogger', () => {
  it('returns a no-op when debug is off or no sink is wired', () => {
    expect(createCommandDebugLogger({})).toBe(NOOP_DEBUG_LOGGER)
    expect(createCommandDebugLogger({ debug: false })).toBe(NOOP_DEBUG_LOGGER)
    expect(createCommandDebugLogger({ emit: () => {} })).toBe(NOOP_DEBUG_LOGGER)
    // The no-op never throws on a message.
    NOOP_DEBUG_LOGGER('ignored')
  })

  it('forwards each message to the sink when debug is on', () => {
    const seen: string[] = []
    const logger = createCommandDebugLogger({
      debug: true,
      emit: (message) => {
        seen.push(message)
      },
    })
    logger('run: cmake --build')
    logger('spawn: ninfer-serve model.ninfer')
    expect(seen).toEqual(['run: cmake --build', 'spawn: ninfer-serve model.ninfer'])
  })
})
