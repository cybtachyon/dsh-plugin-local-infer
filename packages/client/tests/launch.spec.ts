import { describe, expect, it } from 'vitest'
import {
  LAUNCH_HEALTH_DEADLINE_MS,
  LAUNCH_PHASE_STATES,
  LAUNCH_STEP_ORDER,
  STOP_HEALTH_DEADLINE_MS,
  STOP_POLL_MS,
  launchIsPhase,
  launchNextState,
  type LaunchStatus,
} from '../src/machine/launch.ts'

// The machine's full state space, and the step names a step event can
// carry: the four phases plus an unknown name (the no-op path).
const STATES: LaunchStatus[] = [
  'idle',
  'prereqs',
  'download',
  'build',
  'launch',
  'downloading',
  'sudo',
  'running',
  'stopping',
  'failed',
]

const STEPS = ['prereqs', 'download', 'build', 'launch', 'bogus'] as const

type StepName = (typeof STEPS)[number]

// The expected next status for every (state x event) pair. A table value
// equal to the current state is the no-op the machine guarantees for a
// late event.
const START: Record<LaunchStatus, LaunchStatus> = {
  idle: 'prereqs',
  prereqs: 'prereqs',
  download: 'download',
  build: 'build',
  launch: 'launch',
  downloading: 'prereqs',
  sudo: 'sudo',
  running: 'running',
  stopping: 'stopping',
  failed: 'prereqs',
}

const STEP: Record<LaunchStatus, Record<StepName, LaunchStatus>> = {
  idle: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'idle' },
  prereqs: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'prereqs' },
  download: { prereqs: 'download', download: 'download', build: 'build', launch: 'launch', bogus: 'download' },
  build: { prereqs: 'build', download: 'build', build: 'build', launch: 'launch', bogus: 'build' },
  launch: { prereqs: 'launch', download: 'launch', build: 'launch', launch: 'launch', bogus: 'launch' },
  downloading: { prereqs: 'downloading', download: 'downloading', build: 'downloading', launch: 'downloading', bogus: 'downloading' },
  sudo: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'sudo' },
  running: { prereqs: 'running', download: 'running', build: 'running', launch: 'running', bogus: 'running' },
  stopping: { prereqs: 'stopping', download: 'stopping', build: 'stopping', launch: 'stopping', bogus: 'stopping' },
  failed: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'failed' },
}

// The healthy, failed, and downloading events each settle exactly the
// four phase states (plus the sudo wait, for healthy and failed), to a
// different target each.
const HEALTHY: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'running',
  download: 'running',
  build: 'running',
  launch: 'running',
  downloading: 'downloading',
  sudo: 'running',
  running: 'running',
  stopping: 'stopping',
  failed: 'failed',
}

const FAILED: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'failed',
  download: 'failed',
  build: 'failed',
  launch: 'failed',
  downloading: 'downloading',
  sudo: 'failed',
  running: 'running',
  stopping: 'stopping',
  failed: 'failed',
}

const DOWNLOADING: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'downloading',
  download: 'downloading',
  build: 'downloading',
  launch: 'downloading',
  downloading: 'downloading',
  sudo: 'sudo',
  running: 'running',
  stopping: 'stopping',
  failed: 'failed',
}

// sudoNeeded interrupts only the in-flight runs; every other control
// state ignores the announcement, the same guarantee the other events
// give a late event.
const SUDO_NEEDED: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'sudo',
  download: 'sudo',
  build: 'sudo',
  launch: 'sudo',
  downloading: 'sudo',
  sudo: 'sudo',
  running: 'running',
  stopping: 'stopping',
  failed: 'failed',
}

const STOP: Record<LaunchStatus, LaunchStatus> = {
  idle: 'stopping',
  prereqs: 'stopping',
  download: 'stopping',
  build: 'stopping',
  launch: 'stopping',
  downloading: 'downloading',
  sudo: 'stopping',
  running: 'stopping',
  stopping: 'stopping',
  failed: 'failed',
}

const STOPPED: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'prereqs',
  download: 'download',
  build: 'build',
  launch: 'launch',
  downloading: 'downloading',
  sudo: 'sudo',
  running: 'running',
  stopping: 'idle',
  failed: 'failed',
}

const STOP_FAILED: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'prereqs',
  download: 'download',
  build: 'build',
  launch: 'launch',
  downloading: 'downloading',
  sudo: 'sudo',
  running: 'running',
  stopping: 'failed',
  failed: 'failed',
}

const RESET: Record<LaunchStatus, LaunchStatus> = {
  idle: 'idle',
  prereqs: 'idle',
  download: 'idle',
  build: 'idle',
  launch: 'idle',
  downloading: 'idle',
  sudo: 'idle',
  running: 'idle',
  stopping: 'idle',
  failed: 'idle',
}

describe('client launch machine (machine/launch.ts)', () => {
  it('pins the step order and the deadline constants', () => {
    expect(LAUNCH_STEP_ORDER).toEqual({ prereqs: 0, download: 1, build: 2, launch: 3 })
    expect(LAUNCH_PHASE_STATES).toEqual(['prereqs', 'download', 'build', 'launch'])
    expect(LAUNCH_HEALTH_DEADLINE_MS).toBe(150000)
    expect(STOP_POLL_MS).toBe(1000)
    expect(STOP_HEALTH_DEADLINE_MS).toBe(10000)
  })

  it('launchIsPhase recognizes exactly the four rebuild phases', () => {
    for (const phase of LAUNCH_PHASE_STATES) {
      expect(launchIsPhase(phase)).toBe(true)
    }
    for (const state of [
      'idle',
      'downloading',
      'sudo',
      'running',
      'stopping',
      'failed',
    ] as LaunchStatus[]) {
      expect(launchIsPhase(state)).toBe(false)
    }
  })

  for (const status of STATES) {
    it(`prices every event from ${status}`, () => {
      expect(launchNextState({ status }, { type: 'start' })).toEqual({ status: START[status] })
      for (const step of STEPS) {
        expect(launchNextState({ status }, { type: 'step', step })).toEqual({
          status: STEP[status][step],
        })
      }
      expect(launchNextState({ status }, { type: 'healthy' })).toEqual({ status: HEALTHY[status] })
      expect(launchNextState({ status }, { type: 'failed' })).toEqual({ status: FAILED[status] })
      expect(launchNextState({ status }, { type: 'downloading' })).toEqual({
        status: DOWNLOADING[status],
      })
      expect(launchNextState({ status }, { type: 'sudoNeeded' })).toEqual({
        status: SUDO_NEEDED[status],
      })
      expect(launchNextState({ status }, { type: 'stop' })).toEqual({ status: STOP[status] })
      expect(launchNextState({ status }, { type: 'stopped' })).toEqual({ status: STOPPED[status] })
      if (status === 'stopping') {
        // The only transition that sets a cause: the stop deadline.
        expect(launchNextState({ status }, { type: 'stopFailed' })).toEqual({
          status: 'failed',
          cause: 'stop',
        })
      } else {
        expect(launchNextState({ status }, { type: 'stopFailed' })).toEqual({
          status: STOP_FAILED[status],
        })
      }
      expect(launchNextState({ status }, { type: 'reset' })).toEqual({ status: RESET[status] })
    })
  }

  describe('sudo wait (the host is waiting for a password on the terminal)', () => {
    it('step resumes the run at the reported step, with no phase order to guard', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'build' })).toEqual({
        status: 'build',
      })
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'prereqs' })).toEqual({
        status: 'prereqs',
      })
    })

    it('an unknown step name leaves the waiting control at sudo', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'bogus' })).toEqual({
        status: 'sudo',
      })
    })

    it('healthy settles the resumed run to running', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'healthy' })).toEqual({
        status: 'running',
      })
    })

    it('failed settles the 60 s password timeout to failed', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'failed' })).toEqual({
        status: 'failed',
      })
    })

    it('stop moves a run paused on the password to stopping', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'stop' })).toEqual({
        status: 'stopping',
      })
    })

    it('reset settles a waiting control to idle', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'reset' })).toEqual({ status: 'idle' })
    })
  })

  describe('cause-aware entries', () => {
    it('reset reads a stop timeout as running (the engine is probably still up)', () => {
      expect(launchNextState({ status: 'failed', cause: 'stop' }, { type: 'reset' })).toEqual({
        status: 'running',
      })
    })

    it('start re-launches from a stop timeout', () => {
      expect(launchNextState({ status: 'failed', cause: 'stop' }, { type: 'start' })).toEqual({
        status: 'prereqs',
      })
    })

    it('preserves the cause on a no-op stopFailed', () => {
      expect(launchNextState({ status: 'failed', cause: 'stop' }, { type: 'stopFailed' })).toEqual({
        status: 'failed',
        cause: 'stop',
      })
    })

    it('preserves the cause on a no-op step', () => {
      expect(
        launchNextState({ status: 'failed', cause: 'stop' }, { type: 'step', step: 'bogus' }),
      ).toEqual({ status: 'failed', cause: 'stop' })
    })

    it('preserves the cause when sudoNeeded meets a state that cannot wait', () => {
      expect(
        launchNextState({ status: 'failed', cause: 'stop' }, { type: 'sudoNeeded' }),
      ).toEqual({ status: 'failed', cause: 'stop' })
    })

    it('sudoNeeded clears the cause when it interrupts an in-flight run', () => {
      expect(
        launchNextState({ status: 'download', cause: 'stop' }, { type: 'sudoNeeded' }),
      ).toEqual({ status: 'sudo' })
    })

    it('reset settles a sudo wait back to idle (a launch failure reads as Launch)', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'reset' })).toEqual({ status: 'idle' })
    })
  })

  describe('entries without a machine state', () => {
    it('prices a null entry as idle', () => {
      expect(launchNextState(null, { type: 'start' })).toEqual({ status: 'prereqs' })
      expect(launchNextState(null, { type: 'stop' })).toEqual({ status: 'stopping' })
    })

    it('prices an undefined entry as idle', () => {
      expect(launchNextState(undefined, { type: 'stopped' })).toEqual({ status: 'idle' })
    })

    it('prices a late event of unknown type as a no-op', () => {
      expect(
        launchNextState({ status: 'running' }, { type: 'bogus' } as never),
      ).toEqual({ status: 'running' })
    })

    it('prices sudoNeeded from a null entry as a no-op (idle ignores it)', () => {
      expect(launchNextState(null, { type: 'sudoNeeded' })).toEqual({ status: 'idle' })
    })
  })
})
