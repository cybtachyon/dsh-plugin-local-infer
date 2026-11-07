import { describe, expect, it } from 'vitest'
import { LAUNCH_STEPS } from 'dsh-plugin-local-infer/core'
import {
  LAUNCH_HEALTH_DEADLINE_MS,
  LAUNCH_PHASE_STATES,
  LAUNCH_STATE_DISPLAY,
  STOP_HEALTH_DEADLINE_MS,
  STOP_POLL_MS,
  launchDisplayKeyFor,
  launchIsPhase,
  launchNextState,
  type LaunchInFlightStatus,
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

// The server stream is authoritative: a known step sets the reported state
// directly from idle, any phase (forward or back; the host reports the real
// order), and the sudo wait. Only running/stopping (a stop in flight) and
// downloading (the re-poll state) hold, and an unknown name is a no-op.
const STEP: Record<LaunchStatus, Record<StepName, LaunchStatus>> = {
  idle: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'idle' },
  prereqs: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'prereqs' },
  download: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'download' },
  build: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'build' },
  launch: { prereqs: 'prereqs', download: 'download', build: 'build', launch: 'launch', bogus: 'launch' },
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

// The summaryStatus fold: the summary's provider status settles only the
// downloading state (running -> running, stopped -> idle, unsure holds).
// Every other state holds: the machine owns those reads, not the summary.
const SUMMARY_STATUSES = ['running', 'stopped', 'unsure'] as const
type SummaryStatus = (typeof SUMMARY_STATUSES)[number]

const SUMMARY: Record<LaunchStatus, Record<SummaryStatus, LaunchStatus>> = {
  idle: { running: 'idle', stopped: 'idle', unsure: 'idle' },
  prereqs: { running: 'prereqs', stopped: 'prereqs', unsure: 'prereqs' },
  download: { running: 'download', stopped: 'download', unsure: 'download' },
  build: { running: 'build', stopped: 'build', unsure: 'build' },
  launch: { running: 'launch', stopped: 'launch', unsure: 'launch' },
  downloading: { running: 'running', stopped: 'idle', unsure: 'downloading' },
  sudo: { running: 'sudo', stopped: 'sudo', unsure: 'sudo' },
  running: { running: 'running', stopped: 'running', unsure: 'running' },
  stopping: { running: 'stopping', stopped: 'stopping', unsure: 'stopping' },
  failed: { running: 'failed', stopped: 'failed', unsure: 'failed' },
}

describe('client launch machine (machine/launch.ts)', () => {
  it('pins the phase states to the host LaunchStep tuple and the deadline constants', () => {
    // The two sides of the step-name contract (core LAUNCH_STEPS, the machine
    // LAUNCH_PHASE_STATES) stay equal or this fails; each side keeps one
    // table, neither imports the other at runtime.
    expect([...LAUNCH_PHASE_STATES]).toEqual([...LAUNCH_STEPS])
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

  describe('displayText mapping (LAUNCH_STATE_DISPLAY)', () => {
    const IN_FLIGHT: LaunchInFlightStatus[] = [
      'prereqs',
      'download',
      'downloading',
      'build',
      'launch',
      'sudo',
      'stopping',
    ]

    it('maps exactly the seven in-flight states to their label keys', () => {
      expect(LAUNCH_STATE_DISPLAY).toEqual({
        prereqs: 'entryPrereqs',
        download: 'entryDownloading',
        downloading: 'entryDownloading',
        build: 'entryBuilding',
        launch: 'entryLaunching',
        sudo: 'entrySudo',
        stopping: 'stopping',
      })
    })

    it('shares one download label between the download phase and the downloading re-poll', () => {
      expect(LAUNCH_STATE_DISPLAY.download).toBe(LAUNCH_STATE_DISPLAY.downloading)
    })

    it('launchDisplayKeyFor names a key for every in-flight state', () => {
      for (const status of IN_FLIGHT) {
        expect(launchDisplayKeyFor(status)).toBe(LAUNCH_STATE_DISPLAY[status])
      }
    })

    it('launchDisplayKeyFor reads undefined for the states showing no busy label', () => {
      for (const status of ['idle', 'running', 'failed'] as LaunchStatus[]) {
        expect(launchDisplayKeyFor(status)).toBeUndefined()
      }
    })
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
      for (const summaryStatus of SUMMARY_STATUSES) {
        expect(
          launchNextState({ status }, { type: 'summaryStatus', status: summaryStatus }),
        ).toEqual({ status: SUMMARY[status][summaryStatus] })
      }
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

  describe('downloading settle path (the summaryStatus fold)', () => {
    it('settles a downloading engine that reports up to running (Stop)', () => {
      // The launch settled to the health poll's downloading verdict, so the
      // run's stream is spent: the next summary ack reporting the provider
      // running is what turns the Downloading throbber into a Stop.
      let entry = launchNextState(null, { type: 'start' })
      entry = launchNextState(entry, { type: 'downloading' })
      expect(entry.status).toBe('downloading')
      // An unattributable read holds the throbber, not a guess.
      entry = launchNextState(entry, { type: 'summaryStatus', status: 'unsure' })
      expect(entry.status).toBe('downloading')
      entry = launchNextState(entry, { type: 'summaryStatus', status: 'running' })
      expect(entry).toEqual({ status: 'running' })
    })

    it('settles a downloading engine whose process is gone to idle (Launch)', () => {
      // The engine died after the verdict: the confirmed-down landing the
      // stop rule gives an in-flight control, so the entry offers a fresh
      // Launch instead of a throbber that never ends.
      let entry = launchNextState({ status: 'downloading' }, { type: 'summaryStatus', status: 'stopped' })
      expect(entry).toEqual({ status: 'idle' })
    })

    it('never overrides a machine state other than downloading', () => {
      // A stop in flight waits for its own confirmed `stopped`; the summary
      // cannot settle it early.
      expect(
        launchNextState({ status: 'stopping', cause: 'stop' }, { type: 'summaryStatus', status: 'stopped' }),
      ).toEqual({ status: 'stopping', cause: 'stop' })
      // A running engine keeps its Stop even while the dot reads red (the
      // machine owns the Stop read; the row's status-dot Stop branch is the
      // fallback for the lost machine).
      expect(
        launchNextState({ status: 'running' }, { type: 'summaryStatus', status: 'stopped' }),
      ).toEqual({ status: 'running' })
    })
  })

  describe('server stream authoritative (the real Get-steps order)', () => {
    it('advances build then download (the Get-steps sequence the forward-only guard dropped)', () => {
      let entry = launchNextState(null, { type: 'start' })
      expect(entry.status).toBe('prereqs')
      entry = launchNextState(entry, { type: 'step', step: 'build' })
      expect(entry.status).toBe('build')
      // The model download follows the sync/build in the real Get-steps
      // order: a step that moves backward in the old static order now sets
      // the reported state directly.
      entry = launchNextState(entry, { type: 'step', step: 'download' })
      expect(entry.status).toBe('download')
      entry = launchNextState(entry, { type: 'step', step: 'launch' })
      expect(entry.status).toBe('launch')
      entry = launchNextState(entry, { type: 'healthy' })
      expect(entry.status).toBe('running')
    })

    it('a stop in flight supersedes a late step', () => {
      expect(
        launchNextState({ status: 'running' }, { type: 'step', step: 'download' }),
      ).toEqual({ status: 'running' })
      expect(
        launchNextState({ status: 'stopping' }, { type: 'step', step: 'download' }),
      ).toEqual({ status: 'stopping' })
    })

    it('unknown step names stay no-ops from any state', () => {
      expect(launchNextState({ status: 'build' }, { type: 'step', step: 'bogus' })).toEqual({
        status: 'build',
      })
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'bogus' })).toEqual({
        status: 'sudo',
      })
    })

    it('the downloading re-poll state ignores steps', () => {
      expect(launchNextState({ status: 'downloading' }, { type: 'step', step: 'build' })).toEqual({
        status: 'downloading',
      })
      expect(
        launchNextState({ status: 'downloading' }, { type: 'step', step: 'download' }),
      ).toEqual({ status: 'downloading' })
    })

    it('sudo resumes at the reported step whatever it is', () => {
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'download' })).toEqual({
        status: 'download',
      })
      expect(launchNextState({ status: 'sudo' }, { type: 'step', step: 'prereqs' })).toEqual({
        status: 'prereqs',
      })
    })
  })

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
