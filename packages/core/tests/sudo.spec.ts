import { describe, expect, it } from 'vitest'
import {
  guardSudoCommand,
  sudoFailureDetail,
  SUDO_CLI_NOTE,
  SUDO_PASSWORD_TIMEOUT_MS,
  SUDO_PROBE_COMMAND,
} from '../src/index.ts'
import type { SudoGuardOptions, SudoTimer } from '../src/index.ts'

/** A fake clock whose pending callback the test fires or clears by hand. */
function fakeTimer(): {
  timer: SudoTimer
  armMs: () => number | undefined
  fire: () => void
  clears: () => number
} {
  let pending: (() => void) | undefined
  let armMs: number | undefined
  let clears = 0
  return {
    timer: {
      set: (callback, ms) => {
        pending = callback
        armMs = ms
        return 'handle'
      },
      clear: () => {
        clears += 1
        pending = undefined
      },
    },
    armMs: () => armMs,
    fire: () => {
      const callback = pending
      pending = undefined
      callback?.()
    },
    clears: () => clears,
  }
}

/** A probe the tests script; it counts calls so a never-probe is assertable. */
function scriptedProbe(result: boolean): { probe: () => Promise<boolean>; calls: () => number } {
  let calls = 0
  return {
    probe: async () => {
      calls += 1
      return result
    },
    calls: () => calls,
  }
}

/** A recorder for notify and kill with a defaults base for guard options. */
function spyGuardOptions(
  overrides: Partial<SudoGuardOptions> & { needsSudo: boolean },
): { options: SudoGuardOptions; notified: string[]; kills: () => number } {
  const notified: string[] = []
  let kills = 0
  const probe = scriptedProbe(false)
  return {
    notified,
    kills: () => kills,
    options: {
      command: 'sudo apt install cmake',
      probe: probe.probe,
      notify: (command) => notified.push(command),
      kill: () => {
        kills += 1
      },
      ...overrides,
    },
  }
}

describe('sudo constants', () => {
  it('declares the CLI note, the deadline, and the probe command', () => {
    expect(SUDO_CLI_NOTE).toBe('Check your CLI for a sudo prompt')
    expect(SUDO_PASSWORD_TIMEOUT_MS).toBe(60_000)
    expect(SUDO_PROBE_COMMAND).toEqual(['sudo', '-n', 'true'])
  })

  it('names the note and the timeout seconds in the failure detail', () => {
    const detail = sudoFailureDetail('sudo ln -sf /x /usr/local/bin/x')
    expect(detail).toContain('sudo ln -sf /x /usr/local/bin/x')
    expect(detail).toContain(SUDO_CLI_NOTE)
    expect(detail).toContain(String(SUDO_PASSWORD_TIMEOUT_MS / 1000))
  })
})

describe('guardSudoCommand', () => {
  it('passes an undeclared command through: no probe, no notify, no timer', async () => {
    const probe = scriptedProbe(false)
    const timer = fakeTimer()
    const notified: string[] = []
    const guard = await guardSudoCommand({
      command: 'make -j8',
      probe: probe.probe,
      notify: (command) => notified.push(command),
      kill: () => {},
      timer: timer.timer,
    })
    expect(guard.announced).toBe(false)
    expect(probe.calls()).toBe(0)
    expect(notified).toEqual([])
    expect(timer.armMs()).toBeUndefined()
    guard.disarm()
    expect(guard.timedOut()).toBe(false)
  })

  it('passes a needsSudo:false command through the same way', async () => {
    const { options } = spyGuardOptions({ needsSudo: false })
    const timer = fakeTimer()
    const guard = await guardSudoCommand({ ...options, timer: timer.timer })
    expect(guard.announced).toBe(false)
    expect(timer.armMs()).toBeUndefined()
    expect(guard.timedOut()).toBe(false)
  })

  it('skips the announcement and the timer when the probe finds cached credentials', async () => {
    const { options, notified } = spyGuardOptions({ needsSudo: true })
    const probe = scriptedProbe(true)
    const timer = fakeTimer()
    const guard = await guardSudoCommand({ ...options, probe: probe.probe, timer: timer.timer })
    expect(probe.calls()).toBe(1)
    expect(notified).toEqual([])
    expect(timer.armMs()).toBeUndefined()
    expect(guard.announced).toBe(false)
  })

  it('notifies once and kills at the timeout when the probe finds no credentials', async () => {
    const { options, notified, kills } = spyGuardOptions({ needsSudo: true })
    const timer = fakeTimer()
    const guard = await guardSudoCommand({ ...options, timer: timer.timer })
    expect(notified).toEqual(['sudo apt install cmake'])
    expect(guard.announced).toBe(true)
    expect(timer.armMs()).toBe(SUDO_PASSWORD_TIMEOUT_MS)
    timer.fire()
    expect(kills()).toBe(1)
    expect(guard.timedOut()).toBe(true)
  })

  it('arms the injected timeoutMs instead of the default', async () => {
    const { options } = spyGuardOptions({ needsSudo: true })
    const timer = fakeTimer()
    await guardSudoCommand({ ...options, timer: timer.timer, timeoutMs: 5 })
    expect(timer.armMs()).toBe(5)
  })

  it('cancels the kill when the guard is disarmed before the deadline', async () => {
    const { options, kills } = spyGuardOptions({ needsSudo: true })
    const timer = fakeTimer()
    const guard = await guardSudoCommand({ ...options, timer: timer.timer })
    guard.disarm()
    expect(timer.clears()).toBe(1)
    timer.fire()
    expect(kills()).toBe(0)
    expect(guard.timedOut()).toBe(false)
  })

  it('reports timedOut after the deadline fired and disarm changes nothing', async () => {
    const { options, kills } = spyGuardOptions({ needsSudo: true })
    const timer = fakeTimer()
    const guard = await guardSudoCommand({ ...options, timer: timer.timer })
    timer.fire()
    guard.disarm()
    expect(kills()).toBe(1)
    expect(guard.timedOut()).toBe(true)
  })
})
